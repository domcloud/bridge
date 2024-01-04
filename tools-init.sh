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
    sed -i "s/['host'] = ''/['host'] = 'localhost'/" conf/config.inc.php
    sed -i "s/['owned_only'] = false/['owned_only'] = true/g" conf/config.inc.php
    cd ..
else
    cd ./phppgadmin
    git pull
    cd ..
fi

# if [ ! -d "./webssh" ]; then
#     git clone https://github.com/huashengdun/webssh.git webssh --filter=tree:0
#     cd ./webssh
#     pip install --user -r requirements.txt
#     cd ..
# else
#     cd ./webssh
#     git pull
#     pip install --user -r requirements.txt
#     cd ..
# fi
rm -rf webssh

if [ ! -d "./webssh2" ]; then
    git clone https://github.com/billchurch/webssh2.git webssh2 --filter=tree:0
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

npm i
chmod +x sudoutil.js sudokill.js sudocleanssl.js
echo Done! don\'t forget add sudoutil.js to sudoers
echo "echo '`whoami` ALL = (root) NOPASSWD: `echo $PWD`/sudoutil.js' | sudo EDITOR='tee' visudo /etc/sudoers.d/`whoami`"
