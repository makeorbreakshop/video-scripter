// The cacheable half of the tagger: the closed enum, the system block and the tool schema.
// Its own module so the prefix can be token-counted and cache-probed without running a tagging
// pass, and so nothing but this file decides what the model is told.
//
// The enum is read from `angles` / `angle_families`, not from the scratch JSON the MVP seeded
// from. The JSON is the seed's input; the database is the enum. Reading the JSON here meant an
// edit that was seeded but not copied back — or copied back but not seeded — labelled videos
// against a taxonomy the board would then fail to resolve.
import Anthropic from '@anthropic-ai/sdk';

import { q } from '../../lib/admin/db';

export interface Prefix {
  FAMILY_IDS: string[];
  ANGLE_IDS: string[];
  TN_IDS: string[];
  SYSTEM: Anthropic.TextBlockParam[];
  TOOL: Anthropic.Tool;
}

interface Row { id: string; label: string; definition: string; kind: string; family_id: string; family_label: string; family_definition: string | null; position: number }

export async function loadPrefix(): Promise<Prefix> {
  const rows = await q<Row>(
    `select a.id, a.label, a.definition, a.kind, a.family_id,
            f.label as family_label, f.definition as family_definition, f.position
       from angles a join angle_families f on f.id = a.family_id
      where a.active
      order by f.position, a.id`
  );
  if (!rows.length) throw new Error('angles table is empty — run scripts/angles/seed-taxonomy.ts');

  const title = rows.filter((r) => r.kind === 'title');
  const thumb = rows.filter((r) => r.kind === 'thumbnail');
  const FAMILY_IDS = [...new Set(title.map((r) => r.family_id))];
  const ANGLE_IDS = title.map((r) => r.id);
  const TN_IDS = thumb.map((r) => r.id);

  const libraryText = [
    'ANGLE LIBRARY (closed enum, angles_v1). A title angle is the FRAMING of a subject, independent of the subject itself.',
    '',
    ...FAMILY_IDS.map((fid) => {
      const family = title.find((r) => r.family_id === fid)!;
      return [
        `FAMILY ${fid} — ${family.family_definition ?? family.family_label}`,
        ...title.filter((r) => r.family_id === fid).map((r) => `  ${r.id}: ${r.definition}`),
      ].join('\n');
    }),
    '',
    'THUMBNAIL ANGLES (what the image itself does):',
    ...thumb.map((r) => `  ${r.id}: ${r.definition}`),
  ].join('\n');

  return { FAMILY_IDS, ANGLE_IDS, TN_IDS, SYSTEM: system(libraryText), TOOL: tool(FAMILY_IDS, ANGLE_IDS, TN_IDS) };
}

/**
 * The system block carries the cache breakpoint, and as of the unpackaged rules it is finally
 * long enough to engage.
 *
 * Haiku 4.5 will not cache a segment shorter than 4,096 tokens, and below that threshold the API
 * silently ignores the breakpoint: it does not miss, it never writes, so cache_creation and
 * cache_read both come back 0 and nothing in the response says why. That is what the MVP saw and
 * blamed on its own code.
 *
 * Probed 2026-09-16 against claude-haiku-4-5:
 *   system 2,214 tok, no tools              → write 0, read 0
 *   system 4,408 tok, no tools              → write 4,408, then read 4,408
 *   system 2,211 tok + this tool schema     → write 0, read 0   (total input 4,310)
 *   system 4,422 tok + a tool schema        → write 5,576, then read 5,576
 *
 * The third line is why the old prefix never cached: the length test is applied to the block the
 * breakpoint sits on, not to everything ahead of it — tool definitions do not lend their tokens
 * to a system breakpoint. The block was 2,211 tokens and the breakpoint was dead.
 *
 * Measured again 2026-09-16 after the unpackaged rules were added: cacheWrite 4,286 on the
 * warmup batch, cacheRead 4,286 on the next — it now engages, which is worth roughly 90% of the
 * prefix's input cost on every batch after the first. `--count-prefix` prints the current number;
 * if the block is ever trimmed back under 4,096 the saving disappears silently.
 */
function system(libraryText: string): Anthropic.TextBlockParam[] {
  return [
    {
      type: 'text',
      text: [
        'You label YouTube packaging (title + thumbnail) with ANGLES from a fixed library.',
        'Judge only the packaging: the title text, the description snippet, and the thumbnail image. Never guess at video content beyond that.',
        '',
        'FIRST decide whether the video is PACKAGED at all.',
        'Packaged means someone chose a framing to make you click this one thing: a claim, a comparison, a promise, a withheld answer, a warning.',
        'Set unpackaged = true when the title is a manifest of contents rather than a framing — a music mix or hits compilation listing artists or a decade, an episode or season compilation, a sports fixture or highlight reel, a live stream or 24/7 loop, a news bulletin or press conference, a scene clip from a film or show, a recitation or full-album upload, a podcast episode named only by its guest or number.',
        'The test is not the topic and not the channel: it is whether a viewer could read a framing off the packaging and copy it onto a different subject. "80s Greatest Hits | Michael Jackson, Eurythmics, ABBA" is a contents list, not an angle. When unpackaged is true, return angles: [] and thumbnail_angles: [] — do not reach for the nearest label.',
        '',
        'When it IS packaged: pick the angles a viewer would actually read off the packaging. Do not stretch to fill slots: fewer, more accurate labels beat more labels — return one angle when only one clearly applies.',
        'variation must describe the FORM of the title (its shape as packaging), never a summary of the video topic.',
        'Every id you return must be copied exactly from the library below. Never invent an id.',
        '',
        libraryText,
      ].join('\n'),
      cache_control: { type: 'ephemeral' },
    },
  ];
}

function tool(FAMILY_IDS: string[], ANGLE_IDS: string[], TN_IDS: string[]): Anthropic.Tool {
  return {
    name: 'tag_videos',
    description: 'Return one label object for every video given, in the same order.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['videos'],
      properties: {
        videos: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['video_id', 'unpackaged', 'families', 'angles', 'thumbnail_angles', 'variation', 'confidence'],
            properties: {
              video_id: { type: 'string' },
              unpackaged: {
                type: 'boolean',
                description: 'True when the packaging is a contents manifest rather than a framing — compilation, mix, fixture, highlight reel, livestream, bulletin, recitation, scene clip. Must be paired with empty angles and thumbnail_angles.',
              },
              // minItems drops to 0: forcing a label onto every video is what put Euro-disco
              // megamixes under "ranked takeaways".
              families: { type: 'array', maxItems: 2, items: { type: 'string', enum: FAMILY_IDS } },
              angles: { type: 'array', maxItems: 3, items: { type: 'string', enum: ANGLE_IDS } },
              thumbnail_angles: { type: 'array', maxItems: 2, items: { type: 'string', enum: TN_IDS } },
              variation: { type: 'string', description: "At most 12 words naming the SURFACE FORM of the title, not its topic. Good: 'year-bound superlative with tested-them-all promise'. Bad: 'running shoes reviewed'. Empty string when unpackaged." },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
    } as any,
  };
}
