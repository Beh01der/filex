var gulp = require('gulp');
var del = require('del');
var runSequence = require('run-sequence');
var bump = require('gulp-bump');
var gutil = require('gulp-util');
var git = require('gulp-git');
var fs = require('fs');

gulp.task('clean', function(cb) {
    del('build/deploy', cb);
});

gulp.task('copy', function() {
    return gulp.src(['./src', 'package.json'])
        .pipe(gulp.dest('build/deploy'));
});

// bump version / tag / commit
gulp.task('bump-version', function () {
    return gulp.src(['./bower.json', './package.json'])
        .pipe(bump({type: "patch"}).on('error', gutil.log))
        .pipe(gulp.dest('./'));
});

gulp.task('commit-changes', function () {
    return gulp.src('.')
        .pipe(git.commit('[Prerelease] Bumped version number', {args: '-a'}));
});

gulp.task('create-new-tag', function (cb) {
    var version = getPackageJsonVersion();
    git.tag(version, 'Created Tag for version: ' + version, function (error) {
        if (error) {
            return cb(error);
        }
        //git.push('origin', 'master', {args: '--tags'}, cb);
    });

    function getPackageJsonVersion () {
        //We parse the json file instead of using require because require caches multiple calls so the version number won't be updated
        return JSON.parse(fs.readFileSync('./package.json', 'utf8')).version;
    }
});
//////

gulp.task('default', function(cb) {
    runSequence(
        'clean',
        'copy',
        'bump-version',
        'commit-changes',
        'create-new-tag',
        cb);
});