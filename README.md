## 部署流程

文件结构如下：

```
- $WORKDIR
  - app
    - mariadb
    - mediawikifarm
  - infra
    - .env
```

### 创建服务

```sh
cd $WORKDIR/infra
sudo docker compose --env-file .env up -d
```

服务创建成功后前往`portainer.pub.wiki`，分别使用`app/mariadb/docker-compose.yml`以及`app/mediawikifarm/docker-compose.yml`创建数据库服务以及wikifarm服务。

## 新wiki创建流程

文件结构如下：

```
- $WORKDIR (app/mediawikifarm)
  - template
    - mediawiki-1.44.0 (部署模板)
  - wikis
    - wiki1 (wiki1.pub.wiki)
    - wiki2 (wiki2.pub.wiki)
    - ...
```

假设将要创建的wiki名为$WIKINAME

### 构建Mediawiki部署模板

```sh
cd $WORKDIR/template
sudo docker run --rm -v .:/template m4tsuri/pubwiki-template:v1.2
cp -r $WORKDIR/template/mediawiki-1.44.0 $WORKDIR/wikis/$WIKINAME
```

### 初始化wiki

编辑`$WORKDIR/wikis/$WIKINAME/pubwiki.ini`，其中包含下面内容

```
WIKI_SITE_NAME = <wiki站名称>
WIKI_HOST_URL = <wiki地址>
WIKI_META_NAMESPACE = <元命名空间>

WIKI_DB_HOST = <wiki数据库地址>
WIKI_DB_NAME = <wiki数据库名称（非共享）>
WIKI_DB_USER = <wiki数据库用户（非共享）>
WIKI_DB_PASSWORD = <wiki数据库密码>
WIKI_SHARED_DB_NAME = <共享数据库名称> 

WIKI_LANG = <wiki语言>
```

创建新的数据库和数据库用户：

```sql
CREATE DATABASE IF NOT EXISTS ${WIKI_DB_NAME};
CREATE USER IF NOT EXISTS '${WIKI_DB_USER}'@'%' IDENTIFIED BY '${WIKI_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${WIKI_DB_NAME}.* TO '${WIKI_DB_USER}'@'%';
GRANT SELECT, UPDATE, INSERT ON ${WIKI_SHARED_DB_NAME}.user TO '${WIKI_DB_USER}'@'%';
GRANT SELECT, UPDATE, INSERT ON ${WIKI_SHARED_DB_NAME}.user_properties TO '${WIKI_DB_USER}'@'%';
GRANT SELECT, UPDATE, INSERT ON ${WIKI_SHARED_DB_NAME}.actor TO '${WIKI_DB_USER}'@'%';
FLUSH PRIVILEGES;
```

注意，如果我们允许匿名用户编辑，那么我们还需要为这些表添加insert权限

生成OAuth Token

```sh
mkdir /oauth && cd /oauth
openssl genrsa -out oauth.key 2048
openssl rsa -in oautn.key -pubout -out oauth.cert
chown -R www-data:www-data .
```

初始化站点并创建管理员账号

```sh
php /var/www/html/maintenance/installPreConfigured.php
php /var/www/html/maintenance/createAndPromote.php ${WIKI_ADMIN_USER} ${WIKI_ADMIN_PASSWORD} --sysop --bureaucrat --force
```
