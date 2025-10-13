#!/bin/sh

set -e
if [ ! -d /template ];then
    echo "Please mount host dir to /template first";
    exit 127;
fi

wget -O /tmp/mediawiki-1.44.2.tar.gz https://releases.wikimedia.org/mediawiki/1.44/mediawiki-1.44.2.tar.gz
tar -xzf /tmp/mediawiki-1.44.2.tar.gz -C /template --strip-components=1

IP=/template

cd $IP/extensions
mv /extensions/* .

cd $IP
cp /LocalSettings.php .
cp /permissions.json .
cp /composer.local.json .
composer update --no-dev

chmod 644 LocalSettings.php

echo "Creation of template has finished"