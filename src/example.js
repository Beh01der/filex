var request = require('request-json');

var baseUrl = 'http://localhost:3000';
var apiAccessToken = 'ZmM2NzMzMWZiMTkxYjhhNmRkMjQzMzBlMzM0ZWE3NzM5NzU1NmRlYjc4YzM5OGRmYjQ5Yzk';//'put your token here';

function createEmptyBucket(metadata /* optional */) {
    var client = request.createClient(baseUrl);
    client.headers['X-Auth-Token'] = apiAccessToken;

    client.post('/', metadata, function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('%d : %j', res.statusCode, body);
        }
    });
}

function createBucketWithFiles(files, metadata /* optional */) {
    var client = request.createClient(baseUrl);
    client.headers['X-Auth-Token'] = apiAccessToken;

    client.sendFile('/', files, metadata, function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('%d : %j', res.statusCode, body);
        }
    });
}

function updateBucket(bucketId, files, metadata /* optional */) {
    var client = request.createClient(baseUrl);

    client.sendFile('/' + bucketId, files, metadata, function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('%d : %j', res.statusCode, body);
        }
    });
}

function getBucketInfo(bucketId){
    var client = request.createClient(baseUrl);

    client.get('/' + bucketId + '/info', function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('%d : %j', res.statusCode, body);
        }
    });
}

function downloadBucketContents(bucketId, saveToFile) {
    var client = request.createClient(baseUrl);

    client.saveFile('/' + bucketId, saveToFile, function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('Result: %d', res.statusCode);
        }
    });
}
