我想要为一个wikifarm提供创建wiki的provision服务，它将会分为两部分
1. 一个mediawiki的Extension，它提供一个SpecialPage，作为wikifram的首页
   - 从UI设计上，我希望它分为两部分，在桌面端是左右分割，在移动端是上下分割。其中左边（上边）是一个登录表单，右边（下边）分为三部分，分别用于向用户展示wiki列表，展示该用户已经创建的wiki以及一个创建新wiki的表单
   - 从提供的接口上，他分为下面几个部分：
     - 用户能通过提交表单来创建新的wiki，同时能够看到创建进度
     - 能抓取现在适合展示的wiki列表
     - 能抓取某个特定用户创建的wiki列表
   - 该Extension仅仅提供调用相应服务的接口，不实际实现相应的服务
2. 一个将会被容器化运行的微服务，用于实现上述接口。我希望这个服务使用Rust构建。

我使用的mediawiki版本是1.44，使用mariadb作为数据库。请分析上述需求，给出你的设计框架和设计建议。


下一个任务是实现具体的wiki创建工作，wiki的创建分为下面几个步骤：

牵扯到的环境变量：

- `WIKIFARM_DIR`：wikifarm中子wiki所在的目录
- `WIKIFARM_OAUTH_DIR`：wikifarm中子wiki对应的OAuth2证书目录
- `WIKIFARM_TEMPLATE`：创建子wiki时使用的模板目录
- `WIKIFARM_INSTANCE`：wikifarm的docker instance

还有一些额外的环境变量在详细步骤中会提到。

1. 目录创建：Wikifarm是通过目录来区分不同的wiki的，因此创建新的wiki需要一个新的目录，这个目录在`WIKIFARM_DIR`下面。创建时需要将位于`WIKIFARM_TEMPLATE`的模板拷贝到这个子目录，并且将目录重命名为wiki的slug。注意这个拷贝最好是一个CoW拷贝。
2. 配置文件设置：模板中自带了一个未填写的配置文件，包含下面内容：
   ```ini
   WIKI_SITE_NAME = <网站的名称，通过API传入>
   WIKI_HOST_URL = <网站的host URL，形式为slug.$WIKI_ROOT_HOST>
   WIKI_ROOT_HOST = <网站的根域名，定义在同名环境变量中>
   WIKI_META_NAMESPACE = <网站的元命名空间，将网站的名称中的空格替换成下划线得到>
   
   WIKI_DB_HOST = <要连接的数据库端口，定义在同名环境变量中>
   WIKI_DB_NAME = <数据库名称，与slug相同>
   WIKI_DB_USER = <网站的数据库用户名，与slug相同>
   WIKI_DB_PASSWORD = <网站的数据库密码，自动生成>
   WIKI_SHARED_DB_NAME = <用于Wikifarm账号系统同步的共享数据库名称>
   
   WIKI_LANG = <WIKI的语言>
   OPENSEARCH_USER = <Opensearch服务用户名，定义在同名环境变量中>
   OPENSEARCH_PASSWORD = <Opensearch服务用户密码，定义在同名环境变量中>
   OPENSEARCH_ENDPOINT = <Opensearch服务端口，定义在同名环境变量中>
   
   REDIS_PASSWORD = <Redis密码，定义在WIKIFARM_REDIS_SERVER中>
   REDIS_SERVER = <Redis账号，定义在WIKIFARM_REDIS_PASSWORD中>

   WIKI_BOOTSTRAPING = <WIKI是否处于配置阶段，初始时将这个值设置为true，在所有配置完成后将其设置为false>
   ```
   你应当根据这个模板完成对pubwiki.ini文件的编辑。
3. 进行数据库配置工作：每个子wiki都拥有自己的数据库账号，我们需要在运行前为其分配账号。数据库管理员账号已经预先在环境变量中配置好，我们只需要执行这些语句：
   ```sql
   -- 创建该wiki使用的数据库
   CREATE DATABASE IF NOT EXISTS ${WIKI_DB_NAME};
   -- 创建该wiki使用的用户，用户名和密码对应pubwiki.ini中的内容
   CREATE USER IF NOT EXISTS '${WIKI_DB_USER}'@'%' IDENTIFIED BY '${WIKI_DB_PASSWORD}';
   -- 为这个用户授予访问对应数据库的权限
   GRANT ALL PRIVILEGES ON ${WIKI_DB_NAME}.* TO '${WIKI_DB_USER}'@'%';
   -- 为用户授予访问共享账户表的权限
   GRANT SELECT, UPDATE, INSERT ON ${WIKI_SHARED_DB_NAME}.user TO '${WIKI_DB_USER}'@'%';
   GRANT SELECT, UPDATE, INSERT ON ${WIKI_SHARED_DB_NAME}.user_properties TO '${WIKI_DB_USER}'@'%';
   GRANT SELECT, UPDATE, INSERT ON ${WIKI_SHARED_DB_NAME}.actor TO '${WIKI_DB_USER}'@'%';
   FLUSH PRIVILEGES;
   ```
4. 创建OAuth证书：在目录`WIKIFARM_OAUTH_DIR/<slug>`中，产生一个pem格式的公钥文件`oauth.cert`和对应的私钥文件`oauth.key`
5. 初始化站点：调用portainer接口进入wikifarm实例，在相应目录下运行下面代码
   ```sh
   # 执行安装脚本
   php maintenance/run installPreConfigured
   # 初始化索引
   php extensions/CirrusSearch/maintenance/UpdateSearchIndexConfig.php
   ```
6. 通过修改pubwiki.ini中的相应配置项解除bootstraping状态
7. 进行第一次索引：
   ```sh
   php extensions/CirrusSearch/maintenance/ForceSearchIndex.php --skipLinks --indexOnSkip
   php extensions/CirrusSearch/maintenance/ForceSearchIndex.php --skipParse
   ```

上述操作相当复杂，我有几点建议：

1. 在一个新的文件或者目录中开始你的工作
2. 为共用的部分划分模块，做好错误处理和回滚
3. 首先对任务进行分析，得到我的确认后再开始工作

再添加一个manage模块，和provision模块并列，他有下面几个接口

1. 修改站点中的用户权限（只有sysop用户组有权限，用authcheck来做鉴权）。mediawiki的权限管理通过类似这样的语句完成：
   ```php
   $wgGroupPermissions['group']['permission'] = true;
   ```
   
   用户通过POST上传形式如下的Json：
   
   ```json
   {
      "group1": [
         "perm1",
         "perm2"
      ],
      "group2": [
         "perm3"
      ]
   }
   ```
   
   业务逻辑分为两个部分：
   
   1. 将权限数据存储到数据库中
   2. 生成对应的permissions.php文件，放到`<WIKIFARM_CONFIG_DIR>/<slug>/`这个目录下面，这个文件内容就是将上面的json转换成php的对应语句。

   你需要设计对应的数据库scheme并保证permissions.php的内容和数据库中的内容是同步的。
2. 显示当前用户组的对应权限，返回一个json，格式和上面用户post的一样。
