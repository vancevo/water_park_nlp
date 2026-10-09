FROM postgis/postgis:16-3.5

# The base image is Debian bullseye; its pgdg suite moved to the archive host.
RUN sed -i 's#apt.postgresql.org/pub/repos/apt#apt-archive.postgresql.org/pub/repos/apt#' \
      /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install --no-install-recommends -y \
      postgresql-16-pgrouting \
      postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
