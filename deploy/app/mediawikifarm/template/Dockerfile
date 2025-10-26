FROM mediawiki:1.44-fpm

RUN apt-get update \
    && apt-get install -y git wget tar curl openssl zip

WORKDIR /tmp
RUN php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');" \
    && php -r "if (hash_file('sha384', 'composer-setup.php') === 'ed0feb545ba87161262f2d45a633e34f591ebb3381f2e0063c345ebea4d228dd0043083717770234ec00c5a9f9593792') { echo 'Installer verified'.PHP_EOL; } else { echo 'Installer corrupt'.PHP_EOL; unlink('composer-setup.php'); exit(1); }" \
    && php composer-setup.php \
    && php -r "unlink('composer-setup.php');" \
    && mv composer.phar /usr/local/bin/composer

WORKDIR /extensions
RUN git clone https://github.com/Universal-Omega/PortableInfobox.git --depth=1 && \
    cd PortableInfobox && git checkout b700a0c0a1e3a4083ee95601ae041d9c083184c0 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/CSS && \
    cd CSS && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/Elastica && \
    cd Elastica && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/CirrusSearch && \
    cd CirrusSearch && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/OAuth && \
    cd OAuth && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone --recurse-submodules https://gerrit.wikimedia.org/r/mediawiki/extensions/Wikibase && \
    cd Wikibase && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/Analytics && \
    cd Analytics && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone --depth 1 https://github.com/edwardspec/mediawiki-aws-s3.git AWS && \
    cd AWS && git checkout 7a9b9b0587429a4e8842dd1e68abc41c0efd1177 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/MobileFrontend && \
    cd MobileFrontend && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/ApprovedRevs.git && \
    cd ApprovedRevs && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/EventBus && \
    cd EventBus && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/PageForms && \
    cd PageForms && git checkout REL1_44 && \
    composer install --no-dev
RUN git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/PageSchemas && \
    cd PageSchemas && git checkout REL1_44 && \
    composer install --no-dev

WORKDIR /tmp/downloads
RUN wget https://meocap-client-files.oss-cn-beijing.aliyuncs.com/MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 && \
    tar -xvjf MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 --strip-components=1 -C /extensions

RUN rm -rf /tmp/downloads

COPY deploy/app/mediawikifarm/template/create_template_1.44.sh /create_template_1.44.sh
RUN chmod +x /create_template_1.44.sh

COPY deploy/app/mediawikifarm/template/LocalSettings.php /LocalSettings.php
COPY deploy/app/mediawikifarm/template/composer.local.json /composer.local.json 
COPY deploy/app/mediawikifarm/template/permissions.json /permissions.json

COPY extensions/WikiManage /extensions/WikiManage
COPY extensions/EventRecorder /extensions/EventRecorder
COPY extensions/OAuthCentralIDCompact /extensions/OAuthCentralIDCompact

ENTRYPOINT ["/create_template_1.44.sh"]
