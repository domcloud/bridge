#!/bin/bash

if [ ! -d "./phpmyadmin" ]; then
    git clone https://github.com/phpmyadmin/phpmyadmin.git phpmyadmin --filter=tree:0 -b STABLE
    cd ./phpmyadmin
    composer install -o
    yarn install
    yarn build
    cp config.sample.inc.php config.inc.php
    hash=`node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
    sed -ri "s/\['blowfish_secret'\] = '';/['blowfish_secret'] = '${hash}';/g" config.inc.php
    cd ..
else
    cd ./phpmyadmin
    git pull
    composer install -o
    yarn install
    yarn build
    cd ..
fi
if [ ! -d "./phppgadmin" ]; then
    git clone https://github.com/ReimuHakurei/phpPgAdmin.git phppgadmin --filter=tree:0
    cd ./phppgadmin
    cp conf/config.inc.php-dist conf/config.inc.php
    sed -i "s/\['host'\] = ''/['host'] = 'localhost'/g" conf/config.inc.php
    sed -i "s/\['owned_only'\] = false/['owned_only'] = true/g" conf/config.inc.php
    cd ..
else
    cd ./phppgadmin
    git pull
    cd ..
fi


if [ ! -d "./phprdadmin" ]; then
    git clone https://github.com/willnode/phpRedisAdmin phprdadmin --filter=tree:0
    cd ./phprdadmin
    composer install -o
    cp includes/config.sample.inc.php includes/config.inc.php
    sed -i "s/'cookie_auth' => false/'cookie_auth' => true/g" includes/config.inc.php
    sed -i "s/6379/6479/g" includes/config.inc.php
    cd ..
else
    cd ./phprdadmin
    git pull
    cd ..
fi


if [ ! -d "./webssh2" ]; then
    git clone https://github.com/willnode/webssh2.git webssh2 --filter=tree:0
    cd ./webssh2/app
    npm install --omit=dev
    cp config.json.sample config.json
    hash=`node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
    sed -i "s/\"host\": null/\"host\": \"localhost\"/g" config.json
    sed -i "s/\"allowreauth\": false/\"allowreauth\": true/g" config.json
    sed -i "s/\"secret\": \"mysecret\"/\"secret\": \"$hash\"/g" config.json
    sed -i "s/config.listen.port/process.env.PORT/g" index.js
    echo "require('.');" > app.js
    cd ../..
else
    cd ./webssh2/app
    git pull
    npm install --omit=dev
    cd ../..
fi

if ! command -v go &> /dev/null; then
    curl -sS https://webinstall.dev/golang@stable | WEBI__GO_ESSENTIALS=true bash
    source ~/.config/envman/PATH.env
fi

if [ -d "./deployd" ]; then
    cd deployd
    go build
    chmod +x bin
    cd ..
fi

npm i
chmod +x sudoutil.js sudokill.js sudocleanssl.js
echo Done! don\'t forget add sudoutil.js to sudoers
echo "echo '`whoami` ALL = (root) NOPASSWD: `echo $PWD`/sudoutil.js' | sudo EDITOR='tee' visudo /etc/sudoers.d/`whoami`"
echo "sudo bash -c 'mkdir /run/bridge && chown -R $USER:$USER /run/bridge && chmod 0755 -R /run/bridge'"