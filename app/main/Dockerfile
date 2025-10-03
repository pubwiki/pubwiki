FROM mediawiki:1.44

RUN apt update
RUN apt install -y wget vim mariadb-client-compat

WORKDIR /tmp
RUN php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');" \
    && php -r "if (hash_file('sha384', 'composer-setup.php') === 'ed0feb545ba87161262f2d45a633e34f591ebb3381f2e0063c345ebea4d228dd0043083717770234ec00c5a9f9593792') { echo 'Installer verified'.PHP_EOL; } else { echo 'Installer corrupt'.PHP_EOL; unlink('composer-setup.php'); exit(1); }" \
    && php composer-setup.php \
    && php -r "unlink('composer-setup.php');" \
    && mv composer.phar /usr/local/bin/composer

WORKDIR /var/www/html

# Patch mediawiki for a bug
RUN curl https://github.com/wikimedia/mediawiki/commit/54d2416f.patch | git apply
RUN wget https://meocap-client-files.oss-cn-beijing.aliyuncs.com/MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 \
    && tar -xvjf MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 --strip-components=1 -C ./extensions \
    && rm MediaWikiLanguageExtensionBundle-2025.07.tar.bz2

# install PortableInfobox extension
WORKDIR /var/www/html/extensions
RUN git clone https://github.com/Universal-Omega/PortableInfobox.git --depth=1
# install OAuth extension
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/OAuth && \
    cd OAuth && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone --recurse-submodules https://gerrit.wikimedia.org/r/mediawiki/extensions/Wikibase && \
    cd Wikibase && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/Analytics && \
    cd Analytics && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/CSS && \
    cd CSS && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/MobileFrontend && \
    cd MobileFrontend && git checkout REL1_44 && \
    composer install --no-dev

WORKDIR /var/www/html
COPY assets/LocalSettings.php /var/www/html/LocalSettings.php
RUN chmod 644 LocalSettings.php && chown www-data:www-data LocalSettings.php

COPY assets/setup.sh /var/www/html/setup.sh
RUN chown www-data:www-data /var/www/html/setup.sh && chmod +x /var/www/html/setup.sh

RUN pecl install luasandbox

RUN mkdir /oauth && chown www-data:www-data /oauth
