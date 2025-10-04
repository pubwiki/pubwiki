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

cd /var/www/html
php maintenance/installPreConfigured.php
php maintenance/createAndPromote.php ${WIKI_ADMIN_USER} ${WIKI_ADMIN_PASSWORD} --sysop --bureaucrat --force
