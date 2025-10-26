#!/bin/sh

set -e
mysql -u ${WIKI_DB_ADMIN_USER} -p${WIKI_DB_ADMIN_PASSWORD} -h ${WIKI_DB_HOST} <<EOF
CREATE DATABASE IF NOT EXISTS ${WIKI_DB_NAME};
CREATE USER IF NOT EXISTS '${WIKI_DB_USER}'@'%' IDENTIFIED BY '${WIKI_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${WIKI_DB_NAME}.* TO '${WIKI_DB_USER}'@'%';
FLUSH PRIVILEGES;
EOF

echo "MySQL DB setup finished";

cd /oauth
openssl genrsa -out oauth.key 2048
openssl rsa -in oauth.key -pubout -out oauth.cert
chown -R www-data:www-data .
chmod 600 oauth.key
chmod 600 oauth.cert

cd /var/www/html
php maintenance/run installPreConfigured.php
php maintenance/run createAndPromote.php ${WIKI_ADMIN_USER} ${WIKI_ADMIN_PASSWORD} --sysop --bureaucrat --force
php maintenance/run ./extensions/CirrusSearch/maintenance/UpdateSearchIndexConfig.php
php maintenance/run ./extensions/CirrusSearch/maintenance/ForceSearchIndex.php --skipLinks --indexOnSkip
php maintenance/run ./extensions/CirrusSearch/maintenance/ForceSearchIndex.php --skipParse
