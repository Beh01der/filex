/**
 * private:
 *  get     /           - get info about all currently available buckets
 *  post    /?ttl=10    - create new bucket. May be empty or with files. Supports multiple file upload.
 *
 * public:
 *  get     /info?ids=id1,id2,id3           - return info of multiple buckets in array (up to 10)
 *  get     /:id                            - download bucket content (zip) as attachment
 *  get     /:id/info                       - get bucket info
 *  get     /:id/files/:idx|:name           - download file as attachment
 *  get     /:id/files/:idx|:name/stream    - get file as stream
 *
 *  post    /:id            - upload one or more files to the bucket. If file with this name exists in the bucket, it will be replaced.
 *  post    /:id/metadata   - set metadata on bucket
 *
 *  patch   /:id/metadata   - update one or more fields of metadata
 *
 *  delete  /:id                    - delete bucket
 *  delete  /:id/files/:idx|:name   - delete file
 *
 *  bucket info example:
 *      {
 *          id: 'D9LEwTq1hkZOQhEdiH3LGLZ1vELO283H',
 *          time: 1430783435760,
 *          expires: 1430783435760,
 *          ttl: 30,
 *          files: [
 *              {
 *                  name: 'filename.jpg',
 *                  uploaded: 1430783435760
 *                  size: 123435,
 *                  mime: 'image/jpeg',
 *                  sha1: '31f08f658646b526e526570f28ddec381ea212bb'
 *              }
 *          ],
 *          metadata: {
 *              key1: 'value1',
 *              key2: {
 *                  sub-key1: 'sub-value1'
 *              }
 *          }
 *      }
 */

var fs = require('fs');
var crypto = require('crypto');
var express = require('express');
var multer = require('multer');
var bodyParser = require('body-parser');
var Map = require('collections/fast-map');
require("collections/shim-array");
require("collections/shim-object");
require("collections/shim-function");
var randomstring = require("randomstring");
var rimraf = require('rimraf');
var archiver = require('archiver');
var moment = require('moment');
var app = express();

var fileDir = './upload';
var fileSizeLimit = 20;     // 20 Mb
var defaultTtl = 30;        // 30 sec
var fileUploadLimit = 10;   // maximum number of files in a single upload request

function log(message) {
    console.log('%s INFO %s', moment(Date.now()).format(), message);
}

function error(message) {
    console.log('%s ERROR %s', moment(Date.now()).format(), message);
}

rimraf.sync(fileDir);
fs.mkdirSync(fileDir);

if (process.argv.length < 3 || (process.argv[2].length < 32 && process.argv[2] !== '--disable-security')) {
    error('Usage: node src/service.js [secure-token-at-least-32-chars]|--disable-security');
    process.exit(1);
}

var secureToken = process.argv[2];
if (secureToken === '--disable-security') {
    secureToken = undefined;
    log('Warning!!! Security is disabled for this service! It allows public access to all service funcitonality!');
    log('To enable security, pass secure token as a parameter (must be at least 32 char long).');
    log('Example: node src/service.js D9LEwTq1hkZOQhEdiH3LGLZ1vELO283H');
}

function getDir(info) {
    return fileDir + '/' + info.id;
}

var buckets = new Map();

setInterval(function () {
    // cleanup
    var now = Date.now();
    buckets.values().forEach(function (bucket) {
        if (bucket.expires < now) {
            rimraf(getDir(bucket), Function.noop);
            buckets.delete(bucket.id);
            log('Removing expired bucket ' + bucket.id);
        }
    });
}, 60 * 1000);

function findFileIndex(files, fileName) {
    return files.find({ name: fileName }, function(a, b) {
        return a.name === b.name;
    });
}

function bucketInfoOut(info) {
    info = Object.clone(info);
    info.time = moment(info.time).format();
    info.expires = moment(info.expires).format();

    if (info.files) {
        info.files.forEach(function(file) {
            file.uploaded = moment(file.uploaded).format();
        })
    }

    return info;
}

// middlewares
function noCache(req, res, next) {
    res.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
}

function authorise(req, res, next) {
    // authorisation check
    if (secureToken) {
        var token = req.header('X-Auth-Token') || req.query.token;
        if (secureToken !== token) {
            // authentication failed
            return res.status(401).json({
                code: 'ERROR',
                message: 'Access Denied'
            });
        }
    }

    next();
}

function createBucket(req, res, next) {
    var id = randomstring.generate();
    var now = Date.now();
    var ttl = parseInt(req.query.ttl) || defaultTtl;
    var info = {
        id: id,
        time: now,
        ttl: ttl,
        expires: now + ttl * 60 * 1000
    };

    buckets.set(id, info);
    req.bucketInfo = info;

    fs.mkdir(getDir(info), null, function(err) {
        if (err) {
            error('Error creating directory: ' + err.message);
            next(new Error('Error creating directory'));
        } else {
            log('Created bucket ' + id);
            next();
        }
    });
}

function findExistingBucket(req, res, next) {
    var info;
    if (req.params.id) {
        info = buckets.get(req.params.id);
    }

    if (info) {
        req.bucketInfo = info;
        next();
    } else {
        return res.status(404).json({
            code: 'ERROR',
            message: 'Invalid bucket id'
        });
    }
}

function findFileInBucket(req, res, next) {
    var info = req.bucketInfo;
    var idx_or_name = req.params.idx_or_name;
    var files = info.files;
    var fileIdx = -1;
    var file;
    if (idx_or_name) {
        if (isNaN(idx_or_name)) {
            fileIdx = findFileIndex(files, idx_or_name);
        } else {
            fileIdx = parseInt(idx_or_name);
        }
    }

    if (fileIdx !== -1) {
        file = files[fileIdx];
    }

    if (file) {
        req.output = {
            index: fileIdx,
            mime: file.mime,
            filePath: getDir(info) + '/' + file.name,
            fileScope: file
        };

        if (req.params.stream !== 'stream') {
            req.output.fileName = file.name;
        }

        next();
    } else {
        res.status(404).json({
            code: 'ERROR',
            message: 'Invalid file index / name'
        });
    }
}

function handleFileUpload(req, res, next) {
    try {
        // in some cases multer throws error instead of properly handeling it
        (multer({
            dest: getDir(req.bucketInfo),
            limits: {
                fileSize: fileSizeLimit * 1024 * 1024,
                files: fileUploadLimit
            },
            rename: function (fieldname, filename, req) {
                log('Receiving file ' + filename + ' for ' + req.bucketInfo.id);
                return filename;
            },
            onFileUploadStart: function (file, req) {
                file.sha1 = crypto.createHash('sha1');
            },
            onFileUploadData: function (file, data) {
                file.sha1.update(data);
            },
            onFileUploadComplete: function (file, req) {
                var info = req.bucketInfo;
                var files = info.files = info.files || [];
                var i = findFileIndex(files, file.name);

                var fileInfo = {
                    name: file.name,
                    uploaded: Date.now(),
                    size: file.size,
                    mime: file.mimetype && file.mimetype != 'false' ? file.mimetype : 'application/octet-stream',
                    sha1: file.sha1.digest('hex')
                };

                if (i === -1) {
                    files.push(fileInfo);
                } else {
                    files[i] = fileInfo;
                }
            }
        }))(req, res, next);
    } catch (e) {
        next(e);
    }
}

function handleMetadataPost(req, res, next) {
    if (req.body) {
        req.bucketInfo.metadata = req.body;
    }
    next();
}

function handleMetadataPatch(req, res, next) {
    if (req.body) {
        Object.addEach(req.bucketInfo.metadata, req.body);
    }
    next();
}

function prepareBucketZip(req, res, next) {
    var info = req.bucketInfo;
    var dirPath = getDir(info);
    var zipFile = info.id + '.zip';
    var zipPath = dirPath + '/' + zipFile;
    fs.exists(zipPath, function(exists) {
        function prepareOutput() {
            req.output = {
                fileName: 'bucket.zip',
                filePath: zipPath,
                mime: 'application/zip',
                fileScope: info
            };
        }

        if (exists) {
            prepareOutput();
            next();
        } else {
            if (!info.files || !info.files.length) {
                // no files uploaded yet
                req.output = null;
                return next();
            }

            var zip = archiver('zip');
            var output = fs.createWriteStream(zipPath);
            var sha1 = crypto.createHash('sha1');

            zip.on('error', function(err) {
                error('Error creating zip file: ' + err.message);
                next(new Error('Error creating zip file'));
            });

            output.on('data', function(data) {
                sha1.update(data);
            });

            output.on('close', function() {
                // this runs last
                log('Generated bucket.zip for ' + info.id);
                fs.stat(zipPath, function(err, stats) {
                    info.size = stats.size;
                    info.sha1 = sha1.digest('hex');
                    prepareOutput();
                    next();
                });
            });

            zip.pipe(output);
            fs.readdir(dirPath, function (err, files) {
                files.forEach(function (file) {
                    if (file !== zipFile) {
                        zip.file(dirPath + '/' + file, { name: file });
                    }
                });
                zip.finalize();
            });
        }
    });
}

function removeBucketZip(req, res, next) {
    if (req.files && Object.values(req.files).length) {
        // remove old zip file as it's outdated
        var info = req.bucketInfo;
        var zipPath = getDir(info) + '/' + info.id + '.zip';
        rimraf(zipPath, Function.noop);
    }

    next();
}

function removeBucket(req, res, next) {
    var info = req.bucketInfo;

    rimraf(getDir(info));
    buckets.delete(info.id);

    next();
}

function removeFileFromBucket(req, res, next) {
    // let removeBucketZip know that files changed
    req.files = { file: req.output.fileName };
    rimraf(req.output.filePath, Function.noop);
    req.bucketInfo.files.splice(req.output.index, 1);

    next();
}

function listAllBuckets(req, res, next) {
    req.output = buckets.values();
    next();
}

function listSelectedBuckets(req, res, next) {
    var ids = req.query.ids ? req.query.ids.split(',') : [];
    var list;

    req.output = ids.map(function (id) {
        return buckets.get(id);
    });

    next();
}

function returnBucketInfoList(req, res) {
    res.json(req.output.map(bucketInfoOut));
}

function returnFileContent(req, res) {
    var output = req.output;
    if (!output) {
        return res.status(404).json({
            code: 'ERROR',
            message: 'Empty bucket'
        });
    }

    output.fileScope.downloads = (output.fileScope.downloads || 0) + 1;
    if (output.fileName) {
        res.setHeader('Content-disposition', 'attachment; filename=' + output.fileName);
    }

    res.setHeader('Content-type', output.mime);

    log('Returning file ' + output.filePath);
    var stream = fs.createReadStream(output.filePath);
    stream.pipe(res);
}

function returnBucketInfo(req, res) {
    var info = bucketInfoOut(req.bucketInfo);
    info.code = 'OK';
    res.json(info);
}

// ENDPOINTS
app.all('*', noCache);

// create new bucket
app.post('/', authorise, createBucket, handleFileUpload, handleMetadataPost, prepareBucketZip, returnBucketInfo);

// return all buckets info
app.get('/', authorise, listAllBuckets, returnBucketInfoList);

// return selected buckets info
app.get('/info', listSelectedBuckets, returnBucketInfoList);

// update existing bucket
app.post('/:id', findExistingBucket, handleFileUpload, handleMetadataPost, removeBucketZip, prepareBucketZip, returnBucketInfo);

// return zipped bucket contents
app.get('/:id', findExistingBucket, prepareBucketZip, returnFileContent);

// delete bucket
app.delete('/:id', findExistingBucket, removeBucket, returnBucketInfo);

// return single bucket info
app.get('/:id/info', findExistingBucket, returnBucketInfo);

// return file content
app.get('/:id/files/:idx_or_name/:stream?', findExistingBucket, findFileInBucket, returnFileContent);

// delete file from the bucket
app.delete('/:id/files/:idx_or_name', findExistingBucket, findFileInBucket, removeFileFromBucket, removeBucketZip, prepareBucketZip, returnBucketInfo);

// set metadata
app.post('/:id/metadata', findExistingBucket, bodyParser.json(), handleMetadataPost, returnBucketInfo);

// patch metadata
app.patch('/:id/metadata', findExistingBucket, bodyParser.json(), handleMetadataPatch, returnBucketInfo);

// handle all unexpected errors
app.use(function(error, req, res, next) {
    if (error) {
        error('Internal server error: ' + error.message);

        res.status(400).json({
            code: 'ERROR',
            message: 'Invalid request'
        });
    }
});

app.listen(3000, function () {
    log('Listening on port 3000');
});