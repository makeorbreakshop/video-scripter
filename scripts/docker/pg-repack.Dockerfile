# pg_repack 1.5.2 client, built from source against PostgreSQL 15.
#
# WHY A BUILD AND NOT A PACKAGE. pg_repack refuses to run unless the client binary's version
# matches the extension version installed in the database, exactly. Supabase offers exactly one
# version of the extension — 1.5.2, confirmed via pg_available_extension_versions on 2026-09-14 —
# and no prebuilt client of that version exists for this machine:
#
#   brew install pg_repack            -> no such formula (checked 2026-09-14)
#   postgres:15 (trixie)  apt         -> postgresql-15-repack 1.5.3 only
#   postgres:15-bookworm  apt         -> 1.5.3 (pgdg) or 1.4.8 (debian). Neither is 1.5.2.
#
# The local Homebrew psql is 14.17, which is also the wrong major version for a 15.8 server.
#
# Build:
#   docker build -t pg-repack:1.5.2-pg15 -f scripts/docker/pg-repack.Dockerfile scripts/docker
# Verify:
#   docker run --rm pg-repack:1.5.2-pg15 pg_repack --version   # must print exactly 1.5.2
FROM postgres:15-bookworm
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      build-essential postgresql-server-dev-15 libssl-dev liblz4-dev libzstd-dev \
      zlib1g-dev libreadline-dev ca-certificates curl \
 && curl -fsSL https://github.com/reorg/pg_repack/archive/refs/tags/ver_1.5.2.tar.gz -o /tmp/r.tgz \
 && tar -xzf /tmp/r.tgz -C /tmp \
 && make -C /tmp/pg_repack-ver_1.5.2 \
 && make -C /tmp/pg_repack-ver_1.5.2 install \
 && rm -rf /tmp/r.tgz /tmp/pg_repack-ver_1.5.2 /var/lib/apt/lists/* \
 && pg_repack --version
