
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
    git clone https://github.com/phppgadmin/phppgadmin.git phppgadmin --depth 1
    cd ./phppgadmin
    cp conf/config.inc.php-dist conf/config.inc.php
    sed -i "s/['host'] = ''/['host'] = 'localhost'/g" conf/config.inc.php
    cd ..
fi
if [ ! -d "./webssh" ]; then
    git clone https://github.com/huashengdun/webssh.git webssh --depth 1
    cd ./webssh
    pip install --user -r requirements.txt
    cd ..
fi
if [ ! -d "./webssh2" ]; then
    git clone https://github.com/billchurch/webssh2.git webssh2 --depth 1
    cd ./webssh2/app
    npm install --production
    cp config.json.sample config.json
    sed -i "s/\"host\": null/\"host\": \"localhost\"/g" config.json
    cat "require('.');" > app.js
    cd ../..
fi
