import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase-admin"

const DOCUMENT_TYPES = new Set(["notes", "analysis", "script", "research", "template"])

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

function requiredString(value: unknown, field: string, maxLength = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value.trim()
}

async function ownsProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

export async function GET(request: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return errorResponse("Authentication required", 401)

  const resource = request.nextUrl.searchParams.get("resource")
  const projectId = request.nextUrl.searchParams.get("projectId")

  try {
    if (resource === "projects") {
      const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "50", 10)
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50
      const { data, error } = await supabaseAdmin
        .from("projects")
        .select("id,name,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(limit)
      if (error) throw error
      return NextResponse.json({ projects: data || [] })
    }

    if ((resource === "documents" || resource === "script-data") && !projectId) {
      return errorResponse("projectId is required", 400)
    }

    if (resource === "documents") {
      const { data, error } = await supabaseAdmin
        .from("documents")
        .select("id,title,type,content,project_id,created_at,updated_at")
        .eq("project_id", projectId!)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
      if (error) throw error
      return NextResponse.json({ documents: data || [] })
    }

    if (resource === "script-data") {
      const { data, error } = await supabaseAdmin
        .from("script_data")
        .select("id,project_id,data,created_at,updated_at")
        .eq("project_id", projectId!)
        .eq("user_id", userId)
        .maybeSingle()
      if (error) throw error
      return NextResponse.json({ scriptData: data })
    }

    return errorResponse("Unknown workspace resource", 400)
  } catch (error) {
    console.error("Workspace read failed", error)
    return errorResponse("Workspace read failed", 500)
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (origin && origin !== request.nextUrl.origin) {
    return errorResponse("Cross-origin workspace writes are not allowed", 403)
  }

  const userId = await currentUserId()
  if (!userId) return errorResponse("Authentication required", 401)

  try {
    const body = await request.json()
    const now = new Date().toISOString()

    if (body.action === "create-project") {
      const name = requiredString(body.name, "name")
      const { data, error } = await supabaseAdmin
        .from("projects")
        .insert({ name, user_id: userId, created_at: now, updated_at: now })
        .select("id,name,created_at,updated_at")
        .single()
      if (error) throw error
      return NextResponse.json({ project: data }, { status: 201 })
    }

    if (body.action === "create-default-workspace") {
      const name = requiredString(body.name, "name")
      const { data: project, error: projectError } = await supabaseAdmin
        .from("projects")
        .insert({ name, user_id: userId, created_at: now, updated_at: now })
        .select("id,name,created_at,updated_at")
        .single()
      if (projectError) throw projectError

      try {
        const [{ data: document, error: documentError }, { data: scriptData, error: scriptError }] =
          await Promise.all([
            supabaseAdmin
              .from("documents")
              .insert({
                title: "Personal Notes",
                type: "notes",
                content: "",
                project_id: project.id,
                user_id: userId,
                created_at: now,
                updated_at: now,
              })
              .select("id,title,type,content,project_id,created_at,updated_at")
              .single(),
            supabaseAdmin
              .from("script_data")
              .insert({
                project_id: project.id,
                user_id: userId,
                data: body.scriptData ?? {},
                created_at: now,
                updated_at: now,
              })
              .select("id,project_id,data,created_at,updated_at")
              .single(),
          ])
        if (documentError) throw documentError
        if (scriptError) throw scriptError
        return NextResponse.json({ project, document, scriptData }, { status: 201 })
      } catch (error) {
        await supabaseAdmin.from("projects").delete().eq("id", project.id).eq("user_id", userId)
        throw error
      }
    }

    if (body.action === "rename-project") {
      const id = requiredString(body.id, "id", 100)
      const name = requiredString(body.name, "name")
      const { data, error } = await supabaseAdmin
        .from("projects")
        .update({ name, updated_at: now })
        .eq("id", id)
        .eq("user_id", userId)
        .select("id,name,created_at,updated_at")
        .maybeSingle()
      if (error) throw error
      if (!data) return errorResponse("Project not found", 404)
      return NextResponse.json({ project: data })
    }

    if (body.action === "delete-project") {
      const id = requiredString(body.id, "id", 100)
      const { data, error } = await supabaseAdmin
        .from("projects")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle()
      if (error) throw error
      if (!data) return errorResponse("Project not found", 404)
      return NextResponse.json({ ok: true })
    }

    if (body.action === "create-document") {
      const projectId = requiredString(body.projectId, "projectId", 100)
      if (!(await ownsProject(projectId, userId))) return errorResponse("Project not found", 404)
      const title = requiredString(body.title, "title")
      const type = requiredString(body.type, "type", 30)
      if (!DOCUMENT_TYPES.has(type)) return errorResponse("Invalid document type", 400)
      if (typeof body.content !== "string") return errorResponse("content must be a string", 400)
      const { data, error } = await supabaseAdmin
        .from("documents")
        .insert({
          title,
          type,
          content: body.content,
          project_id: projectId,
          user_id: userId,
          created_at: now,
          updated_at: now,
        })
        .select("id,title,type,content,project_id,created_at,updated_at")
        .single()
      if (error) throw error
      return NextResponse.json({ document: data }, { status: 201 })
    }

    if (body.action === "update-document") {
      const id = requiredString(body.id, "id", 100)
      const requested = body.updates && typeof body.updates === "object" ? body.updates : {}
      const updates: Record<string, string> = { updated_at: now }
      if (requested.title !== undefined) updates.title = requiredString(requested.title, "title")
      if (requested.type !== undefined) {
        const type = requiredString(requested.type, "type", 30)
        if (!DOCUMENT_TYPES.has(type)) return errorResponse("Invalid document type", 400)
        updates.type = type
      }
      if (requested.content !== undefined) {
        if (typeof requested.content !== "string") return errorResponse("content must be a string", 400)
        updates.content = requested.content
      }
      const { data, error } = await supabaseAdmin
        .from("documents")
        .update(updates)
        .eq("id", id)
        .eq("user_id", userId)
        .select("id,title,type,content,project_id,created_at,updated_at")
        .maybeSingle()
      if (error) throw error
      if (!data) return errorResponse("Document not found", 404)
      return NextResponse.json({ document: data })
    }

    if (body.action === "delete-document") {
      const id = requiredString(body.id, "id", 100)
      const { data, error } = await supabaseAdmin
        .from("documents")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle()
      if (error) throw error
      if (!data) return errorResponse("Document not found", 404)
      return NextResponse.json({ ok: true })
    }

    if (body.action === "save-script-data") {
      const projectId = requiredString(body.projectId, "projectId", 100)
      if (!(await ownsProject(projectId, userId))) return errorResponse("Project not found", 404)
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("script_data")
        .select("id")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .maybeSingle()
      if (lookupError) throw lookupError

      const query = existing
        ? supabaseAdmin
            .from("script_data")
            .update({ data: body.data ?? {}, updated_at: now })
            .eq("id", existing.id)
            .eq("user_id", userId)
        : supabaseAdmin.from("script_data").insert({
            project_id: projectId,
            user_id: userId,
            data: body.data ?? {},
            created_at: now,
            updated_at: now,
          })
      const { data, error } = await query
        .select("id,project_id,data,created_at,updated_at")
        .single()
      if (error) throw error
      return NextResponse.json({ scriptData: data })
    }

    return errorResponse("Unknown workspace action", 400)
  } catch (error) {
    console.error("Workspace write failed", error)
    if (error instanceof SyntaxError) return errorResponse("Invalid JSON body", 400)
    if (error instanceof Error && /must be a non-empty string/.test(error.message)) {
      return errorResponse(error.message, 400)
    }
    return errorResponse("Workspace write failed", 500)
  }
}
