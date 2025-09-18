FROM mediawiki:1.44-fpm

RUN apt update
RUN apt install -y wget vim mariadb-client-compat

WORKDIR /var/www/html

# Patch mediawiki for a bug
RUN curl https://github.com/wikimedia/mediawiki/commit/54d2416f.patch | git apply

# install PortableInfobox extension
RUN cd extensions && git clone https://github.com/Universal-Omega/PortableInfobox.git --depth=1
# install OAuth extension
RUN cd /tmp && \
    wget https://extdist.wmflabs.org/dist/extensions/OAuth-REL1_44-91ae9b8.tar.gz && \
    tar -xzf OAuth-REL1_44-91ae9b8.tar.gz -C /var/www/html/extensions
RUN cd /tmp && \
    wget https://extdist.wmflabs.org/dist/extensions/Wikibase-REL1_44-3e264d4.tar.gz && \
    tar -xzf Wikibase-REL1_44-3e264d4.tar.gz -C /var/www/html/extensions

# Install Language Extension Bundle
# The bundle is downloaded from https://translatewiki.net/mleb/MediaWikiLanguageExtensionBundle-2025.07.tar.bz2
# Direct download can lead to 403, so we pre downloaded it
COPY assets/MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 /tmp/MediaWikiLanguageExtensionBundle-2025.07.tar.bz2
RUN cd /tmp && \
    tar -xvjf MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 -C /var/www/html

COPY assets/LocalSettings.php /var/www/html/LocalSettings.php
RUN chmod 644 LocalSettings.php && chown www-data:www-data LocalSettings.php

COPY assets/setup.sh /var/www/html/setup.sh
RUN chown www-data:www-data /var/www/html/setup.sh && chmod +x /var/www/html/setup.sh
