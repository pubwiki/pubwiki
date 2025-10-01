FROM mediawiki:1.44-fpm

RUN apt-get update && apt-get install -y curl systemd

RUN curl -L https://github.com/php/pie/releases/download/1.2.1/pie.phar -o /usr/local/bin/pie
RUN chmod +x /usr/local/bin/pie
RUN pie install phpredis/phpredis
