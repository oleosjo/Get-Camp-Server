var express = require('express');
var path = require('path');
var favicon = require('static-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var request = require('req-fast');

var moment = require('moment');
var cacheManager = require('cache-manager');
var redisStore = require('cache-manager-redis');
var parseXml = require('xml2js').parseString;
var xmlBuilder = require('xml2js').Builder;
const camelCase = require('camelcase');
var compression = require('compression');
var SVGO = require('svgo/lib/svgo');

var svgo = new SVGO({});

var CampsiteSerializer = require('./src/campsite-serializer');
var CampsiteDetailSerializer = require('./src/campsite-detail-serializer');

var app = express();

app.use(compression());

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.end(`<h1>${res.locals.message}</h1> <h2>${res.locals.error.status}</h2> <pre>${res.locals.error.stack}</pre>`);
});

var redisCache = cacheManager.caching({
    store: redisStore,
    host: 'localhost', // default value
    port: 6379, // default value
    db: 0,
    ttl: 600
});

function getCampsiteList(cc, pid) {
  let url = `http://www.reserveamerica.com/campsiteSearch.do?xml=true&contractCode=${cc}&parkId=${pid}`;

  return new Promise((resolve, reject) => {
    request(url, (error, response) => {
      parseXml(response.body, (err, jsonResult) => {
        resolve(jsonResult);
      });
    });
  });
}

function getCampsiteDetails(cc, pid, sid) {
  let url = `https://www.reserveamerica.com/campsiteDetails.do?xml=true&contractCode=${cc}&siteId=${sid}&parkId=${pid}`;
  return new Promise((resolve, reject) => {
    request(url, (error, response) => {
      parseXml(response.body, (err, jsonResult) => resolve(jsonResult));
    });
  });
}

app.use(bodyParser.json({ type: 'application/vnd.api+json' }));

app.get('/campsites', function(req, res) {
    var cacheKey = 'campsites:' + req.query.id;
    var ttl = 86400;

    let id = req.query.id.split('-');
    let cc = id[0];
    let pid = id[1];

    redisCache.wrap(cacheKey, function(cacheCallback) {
      getCampsiteList(cc, pid).then((campsiteArray) => {
        let jsonDoc = CampsiteSerializer(campsiteArray);
        cacheCallback(null, jsonDoc);
      }).catch(console.error);

    }, {ttl: ttl}, function(err, data) {
      if (err) {
          err.status = 500;
          res.json(err);
      } else {
          res.json(data);
      }
    });
});

app.get('/campsite-details/:id', function(req, res) {
    var cacheKey = 'campsite-detail:' + req.params.id;
    var ttl = 86400;

    let id = req.params.id.split('-');
    let cc = id[0];
    let pid = id[1];
    let sid = id[2];

    redisCache.wrap(cacheKey, function(cacheCallback) {
      getCampsiteDetails(cc, pid, sid).then((campsiteDetails) => {
        console.log('req');
        let jsonDoc = CampsiteDetailSerializer(campsiteDetails, req.params.id);
        cacheCallback(null, jsonDoc);
      }).catch(console.error);

    }, {ttl: ttl}, function(err, data) {
      if (err) {
          err.status = 500;
          res.json(err);
      } else {
          res.json(data);
      }
    });
});

app.get('/map/background/:cc/:pid', function(req, res) {
  var cacheKey = 'map-background:' + req.params.cc + req.params.pid;
  var ttl = 86400;

  redisCache.wrap(cacheKey, function(cacheCallback) {

    request(`https://www.reserveamerica.com/campgroundDetails.do?contractCode=${req.params.cc}&parkId=${req.params.pid}`,
      (error, response) => {
        // Get session cookie before loading image
        var cookieString = JSON.stringify(response.headers['set-cookie']);
        var re = /JSESSIONID=([^;]*)/ig;
        var jsession = re.exec(cookieString)[1];

        // Load image
        let imgurl = `https://reserveamerica.com/getSVGFragment.do?olAction=getCampgroundMap&contractCode=${req.params.cc}&parkId=${req.params.pid}`;

          request({
            url: imgurl,
            cookies: {
              'JSESSIONID': jsession
            }
          },
          (error, imgres) => {
            cacheCallback(null, imgres.body);
          });

        });
  }, {ttl: ttl}, function(err, data) {
    if (err) {
        err.status = 500;
        res.send(err);
    } else {
        res.contentType('image/svg+xml');
        svgo.optimize(data, function(result) {
          res.end(result.data);
        });
    }
  });

});

app.get('/map/icons/:cc/:pid', function(req, res) {
  var cacheKey = 'campground-amenities:' + req.params.cc + req.params.pid;
  var ttl = 600;

  redisCache.wrap(cacheKey, function(cacheCallback) {

    request(`https://www.reserveamerica.com/campgroundDetails.do?contractCode=${req.params.cc}&parkId=${req.params.pid}`,
      (error, response) => {
        // Get session cookie before loading image
        var cookieString = JSON.stringify(response.headers['set-cookie']);
        var re = /JSESSIONID=([^;]*)/ig;
        var jsession = re.exec(cookieString)[1];

        // Load image
        let imgurl = `https://reserveamerica.com/getSVGFragment.do?olAction=getIcons&contractCode=${req.params.cc}&parkId=${req.params.pid}`;

          request({
            url: imgurl,
            cookies: {
              'JSESSIONID': jsession
            }
          },
          (error, imgres) => {
            svgo.optimize(imgres.body, function(result) {
              parseXml(result.data, (err, jsonResult) => {

                let cleanJSON = jsonResult.svg.g.map((item) => {
                    var re = /campsite|shelter|primitive|camping|tent|electric/ig;
                    var locre = /(\d*\.?\d+\ \d*\.?\d+)\)/ig;
                    var loc = locre.exec(item.$.transform)[1].split(' ');

                    if(!item.title[0].match(re)) {
                      return {
                        mapx: loc[0],
                        mapy: loc[1],
                        title: item.title[0]
                      }
                    }
                });

                cleanJSON = cleanJSON.filter((i) => i);

                cacheCallback(null, cleanJSON);
              });
            });
            //
          });

        });
  }, {ttl: ttl}, function(err, data) {
    if (err) {
        err.status = 500;
        res.send(err);
    } else {
        res.json(data);
    }
  });

});


// listen for redis connection error event
redisCache.store.events.on('redisError', function(error) {
    // handle error here
    console.log('redis error');
});



module.exports = app;
