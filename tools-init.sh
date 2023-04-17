#!/bin/bash

if [ ! -d "./phpmyadmin" ]; then
    git clone https://github.com/phpmyadmin/phpmyadmin.git phpmyadmin -b STABLE --depth 1
    cd ./phpmyadmin
    composer install --no-dev
    yarn install --production
    cp config.sample.inc.php config.inc.php
    hash=`node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
    sed -ri "s/\['blowfish_secret'\] = '';/['blowfish_secret'] = '${hash}';/g" config.inc.php
    cd ..
fi
if [ ! -d "./phppgadmin" ]; then
    git clone https://github.com/phpPgAdmin2/phpPgAdmin.git phppgadmin --depth 1
    cd ./phppgadmin
    cp conf/config.inc.php-dist conf/config.inc.php
    sed -i "s/['host'] = ''/['host'] = 'localhost'/" conf/config.inc.php
    sed -i "s/['owned_only'] = false/['owned_only'] = true/g" conf/config.inc.php
    cd ..
fi
if [ ! -d "./webssh" ]; then
    git clone https://github.com/huashengdun/webssh.git webssh --depth 1
    cd ./webssh
    pip install --user -r requirements.txt
    cd ..
fi

: <<'DISABLED'
if [ ! -d "./webssh2" ]; then
    git clone https://github.com/billchurch/webssh2.git webssh2 --depth 1
    cd ./webssh2/app
    npm install --production
    cp config.json.sample config.json
    hash=`node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
    sed -i "s/\"host\": null/\"host\": \"localhost\"/g" config.json
    sed -i "s/\"allowreauth\": false/\"allowreauth\": true/g" config.json
    sed -i "s/\"secret\": \"mysecret\"/\"secret\": \"$hash\"/g" config.json
    sed -i "s/config.listen.port/process.env.PORT/g" index.js
    echo "require('.');" > app.js
    cd ../..
fi
DISABLED

npm i
chmod +x sudoutil.js
echo You need to add sudoutil.js to sudoers
echo "echo '`whoami` ALL = (root) NOPASSWD: `echo $PWD`/sudoutil.js' | sudo EDITOR='tee' visudo /etc/sudoers.d/`whoami`"
