#!/bin/sh

set -e
mysql -u ${WIKI_DB_ADMIN_USER} -p${WIKI_DB_ADMIN_PASSWORD} -h ${WIKI_DB_HOST} <<EOF
CREATE DATABASE IF NOT EXISTS ${WIKI_DB_NAME};
CREATE USER IF NOT EXISTS '${WIKI_DB_USER}'@'%' IDENTIFIED BY '${WIKI_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${WIKI_DB_NAME}.* TO '${WIKI_DB_USER}'@'%';
FLUSH PRIVILEGES;
EOF

echo "MySQL DB setup finished";

php /var/www/html/maintenance/installPreConfigured.php
php /var/www/html/maintenance/createAndPromote.php ${WIKI_ADMIN_USER} ${WIKI_ADMIN_PASSWORD} --sysop --bureaucrat --force
