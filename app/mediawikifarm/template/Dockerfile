FROM alpine:3.14

RUN apk add --no-cache git wget tar curl

COPY create_template_1.44.sh /create_template_1.44.sh
RUN chmod +x /create_template_1.44.sh

COPY LocalSettings.php /LocalSettings.php
COPY pubwiki.ini /pubwiki.ini

ENTRYPOINT ["/create_template_1.44.sh"]
