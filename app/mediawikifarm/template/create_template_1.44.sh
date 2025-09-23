#!/bin/sh

set -e
if [ ! -d /template ];then
    echo "Please mount host dir to /template first";
    exit 127;
fi

if [ ! -d /oauth ];then
    echo "Please mount host dir to /oauth first";
    exit 127;
fi

wget -O /tmp/mediawiki-1.44.0.tar.gz https://releases.wikimedia.org/mediawiki/1.44/mediawiki-1.44.0.tar.gz
tar -xzf /tmp/mediawiki-1.44.0.tar.gz -C /template --strip-components=1

IP=/template

cd $IP
curl https://github.com/wikimedia/mediawiki/commit/54d2416f.patch | git apply

# download extensions
cd /tmp
wget https://extdist.wmflabs.org/dist/extensions/OAuth-REL1_44-91ae9b8.tar.gz
wget https://extdist.wmflabs.org/dist/extensions/Wikibase-REL1_44-3e264d4.tar.gz
wget https://meocap-client-files.oss-cn-beijing.aliyuncs.com/MediaWikiLanguageExtensionBundle-2025.07.tar.bz2

# extract extensions
tar -xzf OAuth-REL1_44-91ae9b8.tar.gz -C $IP/extensions
tar -xzf Wikibase-REL1_44-3e264d4.tar.gz -C $IP/extensions
tar -xvjf MediaWikiLanguageExtensionBundle-2025.07.tar.bz2 -C $IP

# download extensions from github
cd $IP/extensions
git clone https://github.com/Universal-Omega/PortableInfobox.git --depth=1

cd $IP
cp /LocalSettings.php .
chmod 644 LocalSettings.php
cp /pubwiki.ini .
chmod 644 pubwiki.ini

cd /oauth
openssl genrsa -out oauth.key 2048
openssl rsa -in oauth.key -pubout -out oauth.cert

echo "Creation of template has finished"