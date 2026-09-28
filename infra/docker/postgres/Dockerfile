FROM postgis/postgis:16-3.5

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
      postgresql-16-pgrouting \
      postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
