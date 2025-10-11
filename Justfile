export HTTP_PROXY := "http://172.17.0.1:7893"

template tag:
    docker build --build-arg https_proxy=$HTTP_PROXY --build-arg http_proxy=$HTTP_PROXY -t m4tsuri/pubwiki-template:{{tag}} -f deploy/app/mediawikifarm/template/Dockerfile .

write-template tag dest:
    docker run --rm -e http_proxy=$HTTP_PROXY -e https_proxy=$HTTP_PROXY -v {{dest}}:/template m4tsuri/pubwiki-template:{{tag}}

wikifarm tag:
    docker build --build-arg https_proxy=$HTTP_PROXY --build-arg http_proxy=$HTTP_PROXY -t m4tsuri/pubwikifarm:{{tag}} -f deploy/app/mediawikifarm/Dockerfile .

mainwiki tag:
    docker build --build-arg https_proxy=$HTTP_PROXY --build-arg http_proxy=$HTTP_PROXY -t m4tsuri/pubwiki:{{tag}} -f deploy/app/mainwiki/Dockerfile .

mariadb tag:
    docker build --build-arg https_proxy=$HTTP_PROXY --build-arg http_proxy=$HTTP_PROXY -t m4tsuri/pubwikidb:{{tag}} -f deploy/dev/mariadb/Dockerfile .

provisioner tag:
    docker build --build-arg https_proxy=$HTTP_PROXY --build-arg http_proxy=$HTTP_PROXY -t m4tsuri/pubwiki-provisioner:{{tag}} -f services/provisioner/docker/Dockerfile .

dev-init:
    docker compose --env-file deploy/.dev.env -f deploy/infra/docker-compose.yml up -d
    docker compose --env-file deploy/.dev.env -f deploy/dev/docker-compose.yml   up -d
    docker compose --env-file deploy/.dev.env -f deploy/app/docker-compose.yml   up -d

    - awslocal opensearch create-domain --cli-input-json file://./deploy/dev/opensearch_domain.json --no-cli-pager
    docker exec app-mainwiki-1 /var/www/html/setup.sh

dev-reload:
    docker compose --env-file deploy/.dev.env -f deploy/infra/docker-compose.yml up -d
    docker compose --env-file deploy/.dev.env -f deploy/dev/docker-compose.yml   up -d
    docker compose --env-file deploy/.dev.env -f deploy/app/docker-compose.yml   up -d

dev-restart:
    docker compose --env-file deploy/.dev.env -f deploy/infra/docker-compose.yml stop
    docker compose --env-file deploy/.dev.env -f deploy/dev/docker-compose.yml   stop
    docker compose --env-file deploy/.dev.env -f deploy/app/docker-compose.yml   stop

    docker compose --env-file deploy/.dev.env -f deploy/infra/docker-compose.yml up -d
    docker compose --env-file deploy/.dev.env -f deploy/dev/docker-compose.yml   up -d
    docker compose --env-file deploy/.dev.env -f deploy/app/docker-compose.yml   up -d

fresh-dev:
    docker compose --env-file deploy/.dev.env -f deploy/infra/docker-compose.yml stop
    docker compose --env-file deploy/.dev.env -f deploy/dev/docker-compose.yml   stop
    docker compose --env-file deploy/.dev.env -f deploy/app/docker-compose.yml   stop

    docker compose --env-file deploy/.dev.env -f deploy/infra/docker-compose.yml rm
    docker compose --env-file deploy/.dev.env -f deploy/dev/docker-compose.yml   rm
    docker compose --env-file deploy/.dev.env -f deploy/app/docker-compose.yml   rm

    docker volume rm app_wikifarm-config
    docker volume rm app_wikifarm-oauth
    docker volume rm app_wikifarm-wikis
    docker volume rm dev_wiki-db-data

dev-template tag:
    sudo rm -rf /tmp/wikis/template/*
    docker run --rm -e https_proxy=$HTTP_PROXY -v /tmp/wikis/template:/template m4tsuri/pubwiki-template:{{tag}}
    docker compose --env-file deploy/.dev.env -f deploy/app/docker-compose.yml   stop
    docker compose --env-file deploy/.dev.env -f deploy/app/docker-compose.yml   up -d
    
