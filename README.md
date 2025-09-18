## 部署流程

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

### 构建Mediawiki部署模板

```sh
cd $WORKDIR/template
sudo docker run --rm -v .:/template m4tsuri/pubwiki-template:v1.2
```

### 运行wikifarm服务

```sh
cd $WORKDIR
sudo docker compose up 
```

