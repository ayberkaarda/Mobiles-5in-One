# Local development image for the Askida server: PHP-FPM 8.3 and nginx in one container.
# The same image runs the Horizon worker and the scheduler with a different command.
FROM php:8.3-fpm-bookworm

COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# pg_dump must match the PostgreSQL 16 server (backup:run); Debian bookworm ships 15, so the
# client comes from the PostgreSQL project's apt repository.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx curl unzip git gnupg postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/* \
    && install-php-extensions pdo_pgsql pgsql redis intl gd exif zip bcmath pcntl opcache \
    && rm -f /etc/nginx/sites-enabled/default \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log

COPY php/php.ini /usr/local/etc/php/conf.d/zz-askida.ini
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY php/start-server.sh /usr/local/bin/start-server
RUN chmod 0755 /usr/local/bin/start-server

ENV COMPOSER_ALLOW_SUPERUSER=1
WORKDIR /var/www/html
EXPOSE 80

CMD ["start-server"]
