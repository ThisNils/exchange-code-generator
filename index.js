const axios = require('axios').default;
const { createInterface, emitKeypressEvents } = require('readline');
const {
  readdir, mkdir, writeFile, readFile,
} = require('fs').promises;
const { join } = require('path');
const { write } = require('clipboardy');
const open = require('open');

const makeBool = (text) => text.toLowerCase() === 'y' || text.toLowerCase() === 'yes' || !text;

const consoleQuestion = (question, isYN = false) => new Promise((res) => {
  const itf = createInterface(process.stdin, process.stdout);
  itf.question(isYN ? `${question}(yes/no) ` : question, (answer) => {
    res(isYN ? makeBool(answer) : answer);
    itf.close();
  });
});

const makeForm = (keyValuePairs) => {
  const data = new URLSearchParams();
  Object.keys(keyValuePairs).forEach((key) => data.append(key, keyValuePairs[key]));
  return data.toString();
};

const useDeviceAuth = async (deviceAuth) => {
  const { data: { access_token: accessToken } } = await axios({
    method: 'POST',
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'basic MzQ0NmNkNzI2OTRjNGE0NDg1ZDgxYjc3YWRiYjIxNDE6OTIwOWQ0YTVlMjVhNDU3ZmI5YjA3NDg5ZDMxM2I0MWE=',
    },
    data: makeForm({
      grant_type: 'device_auth',
      account_id: deviceAuth.accountId,
      device_id: deviceAuth.deviceId,
      secret: deviceAuth.secret,
    }),
  });
  return (await axios({
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange',
    headers: {
      Authorization: `bearer ${accessToken}`,
    },
  })).data;
};

const generateDeviceAuth = async (exchangeCode) => {
  const { data: { access_token: accessToken, account_id: accountId } } = await axios({
    method: 'POST',
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'basic MzQ0NmNkNzI2OTRjNGE0NDg1ZDgxYjc3YWRiYjIxNDE6OTIwOWQ0YTVlMjVhNDU3ZmI5YjA3NDg5ZDMxM2I0MWE=',
    },
    data: makeForm({
      grant_type: 'exchange_code',
      exchange_code: exchangeCode,
      includePerms: false,
    }),
  });

  const { data: { deviceId, secret } } = await axios({
    method: 'POST',
    url: `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${accountId}/deviceAuth`,
    headers: {
      Authorization: `bearer ${accessToken}`,
    },
  });
  return { accountId, deviceId, secret };
};

const getDeviceCode = async () => {
  const { data: { access_token: switchAccessToken } } = await axios({
    method: 'POST',
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'basic NTIyOWRjZDNhYzM4NDUyMDhiNDk2NjQ5MDkyZjI1MWI6ZTNiZDJkM2UtYmY4Yy00ODU3LTllN2QtZjNkOTQ3ZDIyMGM3=',
    },
    data: makeForm({
      grant_type: 'client_credentials',
    }),
  });
  const { data: { verification_uri_complete: url, device_code: deviceCode } } = await axios({
    method: 'POST',
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/deviceAuthorization',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `bearer ${switchAccessToken}`,
    },
    data: makeForm({
      prompt: 'login',
    }),
  });
  return { url, deviceCode };
};

const useDeviceCode = (deviceCode) => new Promise((res) => {
  let retries = 0;
  const requestInterval = setInterval(async () => {
    try {
      const { data: { access_token: accessToken } } = await axios({
        method: 'POST',
        url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'basic NTIyOWRjZDNhYzM4NDUyMDhiNDk2NjQ5MDkyZjI1MWI6ZTNiZDJkM2UtYmY4Yy00ODU3LTllN2QtZjNkOTQ3ZDIyMGM3=',
        },
        data: makeForm({
          grant_type: 'device_code',
          device_code: deviceCode,
        }),
      });
      clearInterval(requestInterval);
      const { data: { code: exchangeCode } } = await axios({
        url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange',
        headers: {
          Authorization: `bearer ${accessToken}`,
        },
      });
      res(exchangeCode);
    } catch (err) {
      if (retries >= 24) {
        clearInterval(requestInterval);
        res();
      } else retries += 1;
    }
  }, 10000);
});

(async () => {
  delete axios.defaults.headers.post['Content-Type'];
  const savingFolder = process.env.APPDATA || (process.platform === 'darwin' ? `${process.env.HOME}/Library/Preferences` : `${process.env.HOME}/.local/share`);
  const userFolders = await readdir(savingFolder);
  if (!userFolders.find((f) => f === 'ecg')) await mkdir(join(savingFolder, 'ecg'));
  const savedFiles = await readdir(join(savingFolder, 'ecg'));

  let deviceAuth;
  if (savedFiles.find((sv) => sv === 'deviceauth') && await consoleQuestion('Found a saved profile! Do you want to use it? ', true)) {
    deviceAuth = JSON.parse(await readFile(join(savingFolder, 'ecg', 'deviceauth')));
  } else {
    console.log('Setting up login window');
    const { url, deviceCode } = await getDeviceCode();
    await open(url);
    console.log('Please log into your account');
    const exchangeCode = await useDeviceCode(deviceCode);
    console.log('Saving login credentials');
    deviceAuth = await generateDeviceAuth(exchangeCode);
    await writeFile(join(savingFolder, 'ecg', 'deviceauth'), JSON.stringify(deviceAuth));
  }
  console.log('Generating exchange code');
  const { code: exchangeCode } = await useDeviceAuth(deviceAuth);
  console.log(`\nYour exchange code is: ${exchangeCode}\nYour device auth is ${JSON.stringify(deviceAuth)}\n`);
  console.log('Press E to copy the exchange code to your clipboard\nPress A to copy the device auth to your clipboard\nThis window will auto close in 30 secs');
  const itf = createInterface(process.stdin, process.stdout);
  emitKeypressEvents(process.stdin, itf);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    process.stdout.cursorTo(0);
    process.stdout.write('\r\x1b[K');
    if (key.name.toLowerCase() === 'e') {
      write(exchangeCode);
      console.log('exchange code copied to clipboard');
    } else if (key.name.toLowerCase() === 'a') {
      write(JSON.stringify(deviceAuth, null, 2));
      console.log('device auth copied to clipboard');
    }
  });
  await new Promise((res) => setTimeout(res, 30000));
  itf.close();
})();
