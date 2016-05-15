'use strict';

var cheerio = require('cheerio');
var cmdargs = require('command-line-args');
var fs = require('fs');
var mustache = require('mustache');
var q = require('q');
var request = require('request');

var twodayBlogroll = 'http://twoday.net/main?start='; // 0,15,30,45, ...
var timeoutAfterEachPageRequest = 100; // pause 100 milliseconds
var timeoutAfterEachStoryRequest = 50; // pause 50 milliseconds

var maxAnalyzePages = 20; // check last xx blogroll pages (node parameter --pages=xx or -p xx)
var daysBlogQualifiesAsAbandoned = 365; // at minimum 1 year no blog action (node parameter --abandoned=xx or -a xx)
var minimumSpamCommentsToQualify = 10; // must have at least 10 spam comments to be listed (node parameter --minspam=xx or -m xx)

var getAlias = function(uri) {
    return uri.match(/http:\/\/(.*).twoday.net/)[1];
};

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

var analyzeHistoryItems = function($) {
    var historyItems = $(".historyItem a[href*='.twoday.net/stories/']");
    var link, postsWithComments = [];
    historyItems.each( function(){
        link = $(this);
        postsWithComments.push( link.attr('href').split('#')[0]+'#comments' );
    });
    return postsWithComments;
};

var analyzeFrontPostsWithCommments = function($) {
    var storyLinks = $(".storyLinks a[href*='#comments']");
    var link, comments, postsWithComments = [];
    storyLinks.each( function(){
        link = $(this);
        comments = parseInt(link.text(), 10);
        if (comments>0) postsWithComments.push( {uri: link.attr('href'), spammed: false} );
    });
    return postsWithComments;
};

var analyzeRecentPosts = function(body) {
    var $ = cheerio.load(body);
    var posts = analyzeFrontPostsWithCommments($);
    analyzeHistoryItems($).map( function(link) {
        if (posts.indexOf(link)<0) posts.push( {uri: link, spammed: false} );
    });
    return posts;
};

var isWhitelisted = function(href) {
    var isOnWhitelist = false, i = 0, len = whitelist.length;
    while (i<len && !isOnWhitelist) {
        isOnWhitelist = (href.indexOf(whitelist[i])>=0);
        i++;
    }
    return isOnWhitelist;
};

var isGuestUser = function(user) {
    return (user.indexOf('(gast)')>=0 || user.indexOf('(guest)')>=0);
};

var analyzePostForSpam = function(body, uri) {
    var $ = cheerio.load(body);
    var commentLinks = $(".commentDate>a");
    var link, href, user, totalComments = 0, spamLinks = [];
    commentLinks.each( function(){
        totalComments++;
        link = $(this);
        href = link.attr('href');
        user = link.text();
        if (isGuestUser(user.toLowerCase()) && !isWhitelisted(href)) {
            spamLinks.push( href+' ('+user+')' );
        }
    });
    return { uri: uri, totalComments: totalComments, spamLinks: spamLinks };
};

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

var fireAllPageRequests = function() {

    for (var page=0, promises=[]; page<maxAnalyzePages; ++page) {
        promises.push(requestBlogrollPage(page));
    }
    return promises;

};

var findAllRecentPostsWithComments = function(suspectiveBlogs) {

    for (var blog=0, promises=[], blogs=Object.keys(suspectiveBlogs), total=blogs.length; blog<total; ++blog) {
        promises.push(requestBlogPage(blogs[blog], blog));
    }
    return promises;

};

var inspectPostsForSpam = function(suspectiveBlogs) {

    var index = 0;
    for (var blog=0, promises=[], blogs=Object.keys(suspectiveBlogs), total=blogs.length; blog<total; ++blog) {
        var alias = blogs[blog];
        for (var post=0, posts=suspectiveBlogs[alias].analyzedPosts.length; post<posts; ++post) {
            promises.push(requestPost(suspectiveBlogs[alias].analyzedPosts[post].uri, index++));
        }
    }
    return promises;

};

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
            dirtyPosts: dirtyPosts,
            spamLinks: suspect.spamLinks
        });
    }

    var listOutput = mustache.render(mainHTML, mustacheViewModel);
    fs.writeFileSync('./Liste_der_Twoday_Spamblogs.html', listOutput, 'utf8');
    console.log('HTML output completed.');

};

var options = cmdargs([
    { name: 'help', alias: 'h', type: Boolean, defaultValue: false },
    { name: 'pages', alias: 'p', type: Number, defaultValue: 10 },
    { name: 'abandoned', alias: 'a', type: Number, defaultValue: 365 },
    { name: 'minspam', alias: 'm', type: Number, defaultValue: 15 }
]).parse();

if (options.help) {
    console.log('\nAufruf von findspamblogs.js mit folgenden möglichen Parametern:');
    console.log('\tnode findspamblogs --pages=<blogrollpages> --abandoned=<days> --minspam=<number>');
    console.log('oder:');
    console.log('\tnode findspamblogs -p <blogrollpages> -a <days> -m <number>');
    console.log('Defaultwerte: pages=10, abandoned=365, minspam=15');
    return;
}

maxAnalyzePages = options.pages;
daysBlogQualifiesAsAbandoned = options.abandoned;
minimumSpamCommentsToQualify = options.minspam;

var whitelist = fs.readFileSync('./whitelist.txt', 'utf8').trim().split('\r\n');

var suspectiveBlogs = {};
q.all(fireAllPageRequests())
    .then( function(results) {
        results.forEach( function (suspects) {
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
        blogPosts.forEach( function (post) { // { uri: uri, totalComments: totalComments, spamLinks: spamLinks }
            var alias = getAlias(post.uri);
            var suspectiveBlog = suspectiveBlogs[alias];
            if (suspectiveBlogs.hasOwnProperty(alias)) {
                suspectiveBlog.analyzedComments += post.totalComments;
                suspectiveBlog.spamComments += post.spamLinks.length;
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