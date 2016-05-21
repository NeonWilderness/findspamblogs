'use strict';

var cheerio = require('cheerio');
var cmdargs = require('command-line-args');
var fs = require('fs');
var mustache = require('mustache');
var q = require('q');
var request = require('request');

var twodayBlogroll = 'http://twoday.net/main?start='; // 0,15,30,45, ...
var timeoutAfterEachPageRequest = 100; // pause 100 milliseconds
var timeoutAfterEachStoryRequest = 80; // pause 80 milliseconds

var maxAnalyzePages = 20; // check last 20 blogroll pages (node parameter --pages=xx or -p xx)
var daysBlogQualifiesAsAbandoned = 365; // at minimum 1 year no blog action (node parameter --abandoned=xx or -a xx)
var minimumSpamCommentsToQualify = 20; // must have at least 20 spam comments to be listed (node parameter --minspam=xx or -m xx)

/**
 * Extract blogalias from a given twoday url
 * @param uri Twoday url
 * @returns {*} Twoday alias
 */
var getAlias = function(uri) {
    return uri.match(/http:\/\/(.*).twoday.net/)[1];
};

/**
 * Analyzes a full blogroll page (15 blogs), extracts all blogs that seem to be abandoned
 * @param body HTML of requested blogroll page
 * @returns {Array} abandoned blogs array [{ alias, lastPostPublished }, ...]
 */
var analyzeBlogrollPage = function(body) {
    var $ = cheerio.load(body);
    var storyLinks = $("td").find("a[href*='.twoday.net/stories/']");
    var link, alias, lastAlias = null, lastPostPublished, suspects = [];
    storyLinks.each( function(){
        link = $(this);
        alias = getAlias(link.attr("href"));
        if (alias===lastAlias) return true;
        lastAlias = alias;
        try {
            lastPostPublished = parseInt(link.next().text().split("vor ")[1], 10);
        } catch(e) {
            lastPostPublished = 0;
        }
        if (lastPostPublished>daysBlogQualifiesAsAbandoned) {
            suspects.push( { alias: alias, lastPostPublished: lastPostPublished } );
        }
    });
    return suspects;

};

/**
 * Extract story links from the history infobox in the Twoday sidebar and add them to frontpage story links array if not redundant
 * @param $ cheerio body HTML
 * @param posts intermediate array holding frontpage story links
 * @returns {Array} story links array
 */
var analyzeHistoryItems = function($, posts) {
    var historyItems = $(".historyItem a[href*='.twoday.net/stories/']");
    var link, uri;
    historyItems.each( function(){
        link = $(this);
        uri = link.attr('href').split('#')[0]+'#comments';
        if (posts.indexOf(uri)<0) posts.push( uri );
    });
    return posts;
};

/**
 * Extract all links to stories with comments from the blog's frontpage
 * @param $ cheerio body HTML
 * @returns {Array} array of links to stories with comments
 */
var analyzeFrontPostsWithCommments = function($) {
    var storyLinks = $(".storyLinks a[href*='#comments']");
    var link, comments, postsWithComments = [];
    storyLinks.each( function(){
        link = $(this);
        comments = parseInt(link.text(), 10);
        if (comments>0) postsWithComments.push( link.attr('href') );
    });
    return postsWithComments;
};

/**
 * Analyze recent posts of a blog's mainpage (frontpage posts and history posts)
 * @param body blog's frontpage HTML
 * @returns {Array} array of identified links to stories with comments
 */
var analyzeRecentPosts = function(body) {
    var $ = cheerio.load(body);
    return analyzeHistoryItems($, analyzeFrontPostsWithCommments($)).map( function(link) {
        return {uri: link, spammed: false};
    });
};

/**
 * Checks if a given href contains at least one string on the whitelist
 * @param href
 * @returns {boolean}
 */
var isWhitelisted = function(href) {
    var isOnWhitelist = false, i = 0, len = whitelist.length;
    while (i<len && !isOnWhitelist) {
        isOnWhitelist = (href.indexOf(whitelist[i])>=0);
        i++;
    }
    return isOnWhitelist;
};

/**
 * Checks if a given user reference is a guest user id
 * @param user
 * @returns {boolean}
 */
var isGuestUser = function(user) {
    return (user.indexOf('(gast)')>=0 || user.indexOf('(guest)')>=0);
};

/**
 * Validates all comment links of a given post and checks if they qualify for spam
 * If recognized as spam, remember spam user (save to array)
 * @param body
 * @param uri
 * @returns {{uri: *, totalComments: number, spamLinks: Array}}
 */
var analyzePostForSpam = function(body, uri) {
    var $ = cheerio.load(body);
    var commentLinks = $(".commentDate>a");
    var link, href, user, totalComments = 0, spamComments = 0, spamUser, spamLinks = [];
    commentLinks.each( function(){
        totalComments++;
        link = $(this);
        href = link.attr('href');
        user = link.text();
        if (isGuestUser(user.toLowerCase()) && !isWhitelisted(href)) {
            spamComments++;
            spamUser = href+' ('+user+')';
            if (spamLinks.indexOf(spamUser)<0) spamLinks.push( spamUser );
        }
    });
    return { uri: uri, totalComments: totalComments, spamComments: spamComments, spamLinks: spamLinks };
};

/**
 * Requests a blogroll page and returns a promise
 * @param page
 * @returns {*|promise}
 */
var requestBlogrollPage = function (page) {

    var deferred = q.defer();
    var uri = twodayBlogroll+(page*15);

    q.delay(timeoutAfterEachPageRequest*page).then( function() {
        console.log('Now requesting page...', page);
        request(uri, function (err, res, body) {
            if (err) {
                console.log(uri, ' @ error ', err);
                deferred.reject(page);
            } else {
                deferred.resolve(analyzeBlogrollPage(body));
            }
        });
    });

    return deferred.promise;
};

/**
 * Requests a blog's main page (homepage) and returns a promise
 * @param alias Twoday blog alias
 * @param index sequence number of blog to calculate the timeout delay
 * @returns {*|promise}
 */
var requestBlogPage = function (alias, index) {

    var deferred = q.defer();
    var uri = 'http://'+alias+'.twoday.net/';

    q.delay(timeoutAfterEachPageRequest*index).then( function() {
        console.log('Now searching...', uri);
        request(uri, function (err, res, body) {
            if (err) {
                console.log(uri, ' @ error ', err);
                deferred.reject(uri, err);
            } else {
                deferred.resolve(analyzeRecentPosts(body));
            }
        });
    });

    return deferred.promise;
};

/**
 * Requests a post uri and returns a promise
 * @param uri
 * @param index sequence number of post to calculate the timeout delay
 * @returns {*|promise}
 */
var requestPost = function (uri, index) {

    var deferred = q.defer();

    q.delay(timeoutAfterEachStoryRequest*index).then( function() {
        console.log('Inspecting...', uri);
        request(uri, function (err, res, body) {
            if (err) {
                console.log(uri, ' @ error ', err);
                deferred.reject(uri, err);
            } else {
                deferred.resolve(analyzePostForSpam(body, uri));
            }
        });
    });

    return deferred.promise;
};

/**
 * Launches all promises for all requested blogroll pages
 * @returns {Array} of promises to be handled with q.all()
 */
var fireAllPageRequests = function() {

    for (var page=0, promises=[]; page<maxAnalyzePages; page++) {
        promises.push(requestBlogrollPage(page));
    }
    return promises;

};

/**
 * Launches all promises for all requested blog homepages
 * @param suspectiveBlogs
 * @returns {Array} of promises to be handled with q.all()
 */
var findAllRecentPostsWithComments = function(suspectiveBlogs) {

    for (var blog=0, promises=[], blogs=Object.keys(suspectiveBlogs), total=blogs.length; blog<total; blog++) {
        promises.push(requestBlogPage(blogs[blog], blog));
    }
    return promises;

};

/**
 * Launches all promises for all requested posts of a given blog
 * @param suspectiveBlogs
 * @returns {Array} of promises to be handled with q.all()
 */
var inspectPostsForSpam = function(suspectiveBlogs) {

    var index = 0;
    for (var blog=0, promises=[], blogs=Object.keys(suspectiveBlogs), total=blogs.length; blog<total; blog++) {
        var alias = blogs[blog];
        for (var post=0, posts=suspectiveBlogs[alias].analyzedPosts.length; post<posts; post++) {
            promises.push(requestPost(suspectiveBlogs[alias].analyzedPosts[post].uri, index++));
        }
    }
    return promises;

};

/**
 * Render spam blog infos to an HTML output by utilizing MustacheJS
 * @param suspects
 */
var renderSpammedBlogs = function(suspects) {
    var today = new Date();
    var mustacheViewModel = {
        today: today.toLocaleString(),
        maxAnalyzePages: maxAnalyzePages,
        daysBlogQualifiesAsAbandoned: daysBlogQualifiesAsAbandoned,
        minimumSpamCommentsToQualify: minimumSpamCommentsToQualify,
        spamBlogs: []
    };
    console.log('Rendering output html file...');
    var mainHTML = fs.readFileSync('./html/spamMain.html', 'utf8');

    for (var i=0, blogs=Object.keys(suspects), len=blogs.length; i<len; i++) {
        var alias = blogs[i];
        var suspect = suspects[alias];
        if (suspect.spamComments<minimumSpamCommentsToQualify) continue;
        var yearsPassed = Math.floor(suspect.lastPostPublished/365);
        var monthsPassed = Math.round((suspect.lastPostPublished/365-yearsPassed)*12);
        for (var j=0, posts=suspect.analyzedPosts.length, dirtyPosts=[]; j<posts; j++) {
            var post = suspect.analyzedPosts[j];
            if (post.spammed) dirtyPosts.push(post.uri);
        }
        mustacheViewModel.spamBlogs.push( {
            alias: alias,
            lastPostPublished: suspect.lastPostPublished,
            timePassed: '(~ ' + yearsPassed + ' Jahr' + (yearsPassed===1 ? '' : 'e') +
                        ', '+ monthsPassed + ' Monat' + (monthsPassed===1 ? '' : 'e') + ')',
            analyzedPosts: posts,
            spammedPosts: dirtyPosts.length,
            spamComments: suspect.spamComments,
            dirtiness: Math.round(suspect.spamComments/suspect.analyzedComments*100),
            dirtyPosts: dirtyPosts.sort(),
            spamLinks: suspect.spamLinks.sort()
        });
    }

    var listOutput = mustache.render(mainHTML, mustacheViewModel);
    fs.writeFileSync('./Liste_der_Twoday_Spamblogs.html', listOutput, 'utf8');
    console.log('HTML output completed.');

};

/**
 * Start main processing
 */

// parse command line parameters
var options = cmdargs([
    { name: 'help', alias: 'h', type: Boolean, defaultValue: false },
    { name: 'pages', alias: 'p', type: Number, defaultValue: maxAnalyzePages },
    { name: 'abandoned', alias: 'a', type: Number, defaultValue: daysBlogQualifiesAsAbandoned },
    { name: 'minspam', alias: 'm', type: Number, defaultValue: minimumSpamCommentsToQualify }
]).parse();

// log help message if so requested and stop script
if (options.help) {
    console.log('\nAufruf von findspamblogs.js mit folgenden möglichen Parametern:');
    console.log('\tnode findspamblogs --pages=<blogrollpages> --abandoned=<days> --minspam=<number>');
    console.log('oder:');
    console.log('\tnode findspamblogs -p <blogrollpages> -a <days> -m <number>');
    console.log('Defaultwerte: pages=%d, abandoned=%d, minspam=%d', maxAnalyzePages, daysBlogQualifiesAsAbandoned, minimumSpamCommentsToQualify);
    return;
}

// save resulting parameter values (either given by user or by default)
maxAnalyzePages = options.pages;
daysBlogQualifiesAsAbandoned = options.abandoned;
minimumSpamCommentsToQualify = options.minspam;

// load whitelist text file and split strings to array
var whitelist = fs.readFileSync('./whitelist.txt', 'utf8').trim().split('\r\n');

// clear result object
var suspectiveBlogs = {};
// fire all blogroll page requests and wait for promises to be resolved/rejected
q.all(fireAllPageRequests())
    .then( function(results) {
        results.forEach( function (suspects) {
            // for each identified suspect, create an object property
            suspects.forEach( function(suspect) {
                if (!suspectiveBlogs.hasOwnProperty(suspect.alias)) {
                    suspectiveBlogs[suspect.alias] = {
                        lastPostPublished: suspect.lastPostPublished,
                        analyzedPosts: [],
                        analyzedComments: 0,
                        spamComments: 0,
                        spamLinks: []
                    };
                }
            });
        });
        // and return the promises to find all recent posts with comments
        return q.all(findAllRecentPostsWithComments(suspectiveBlogs));
    })
    .then( function(blogs) {
        blogs.forEach( function (postsWithComments) { // [ { uri: uri, spammed: false }, ... ]
            if (postsWithComments.length>0) {
                var alias = getAlias(postsWithComments[0].uri);
                suspectiveBlogs[alias].analyzedPosts = postsWithComments;
            }
        });
        return q.all(inspectPostsForSpam(suspectiveBlogs));
    })
    .then( function(blogPosts) {
        blogPosts.forEach( function (post) { // { uri: uri, totalComments: totalComments, spamComments: spamComments, spamLinks: spamLinks }
            var alias = getAlias(post.uri);
            var suspectiveBlog = suspectiveBlogs[alias];
            if (suspectiveBlogs.hasOwnProperty(alias)) {
                suspectiveBlog.analyzedComments += post.totalComments;
                suspectiveBlog.spamComments += post.spamComments;
                if (post.spamLinks.length > 0) {
                    for (var idx=0, lenP=suspectiveBlog.analyzedPosts.length; idx<lenP; idx++) {
                        if (suspectiveBlog.analyzedPosts[idx].uri===post.uri) break;
                    }
                    if (idx<lenP)
                        suspectiveBlog.analyzedPosts[idx].spammed = true;
                    else
                        console.log('>>> post', post.uri, 'not found in analyzedPosts.');
                    for (var spam=0, lenS=post.spamLinks.length; spam<lenS; ++spam) {
                        if (suspectiveBlog.spamLinks.indexOf(post.spamLinks[spam])<0)
                            suspectiveBlog.spamLinks.push(post.spamLinks[spam]);
                    }
                }
            }
        });
    })
    .done( function(){
        renderSpammedBlogs(suspectiveBlogs);
        //console.log(JSON.stringify(suspectiveBlogs, null, '\t'));
        console.log('*** End of analysis: see results in file "Liste_der_Twoday_Spamblogs.html" ***');
    });