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

