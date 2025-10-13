# Multi-stage build for wikifarm provisioner service
FROM rust:bullseye AS build
WORKDIR /build
# Cache deps
COPY services/runjobs/docker/Cargo.workspace.toml Cargo.toml

# Pre-build deps (create minimal workspace to cache dependencies)
RUN mkdir -p service/src && echo 'fn main() {}' > service/src/main.rs
COPY services/runjobs/Cargo.toml service/Cargo.toml
RUN cargo build --release -p runjobs

# Real source
COPY services/runjobs/src service/src
RUN cargo build --release -p runjobs

FROM mediawiki:1.44-fpm

RUN apt-get update && apt-get install -y curl systemd

WORKDIR /tmp
RUN php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');" \
    && php -r "if (hash_file('sha384', 'composer-setup.php') === 'ed0feb545ba87161262f2d45a633e34f591ebb3381f2e0063c345ebea4d228dd0043083717770234ec00c5a9f9593792') { echo 'Installer verified'.PHP_EOL; } else { echo 'Installer corrupt'.PHP_EOL; unlink('composer-setup.php'); exit(1); }" \
    && php composer-setup.php \
    && php -r "unlink('composer-setup.php');" \
    && mv composer.phar /usr/local/bin/composer

RUN curl -L https://github.com/php/pie/releases/download/1.2.1/pie.phar -o /usr/local/bin/pie
RUN chmod +x /usr/local/bin/pie
RUN pie install phpredis/phpredis

COPY --from=build /build/target/release/runjobs /usr/local/bin/runjobs
COPY deploy/app/mediawikifarm/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN mkdir -p /cache/mediawiki && chown www-data:www-data /cache/mediawiki

CMD [ "/entrypoint.sh" ]
