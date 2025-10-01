FROM composer:latest

RUN apk add --no-cache git wget tar curl openssl

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

WORKDIR /tmp/downloads
RUN wget https://meocap-client-files.oss-cn-beijing.aliyuncs.com/MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 && \
    tar -xvjf MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 --strip-components=1 -C /extensions

RUN rm -rf /tmp/downloads

COPY create_template_1.44.sh /create_template_1.44.sh
RUN chmod +x /create_template_1.44.sh

COPY LocalSettings.php /LocalSettings.php
COPY composer.local.json /composer.local.json 
COPY permissions.json /permissions.json

ENTRYPOINT ["/create_template_1.44.sh"]
