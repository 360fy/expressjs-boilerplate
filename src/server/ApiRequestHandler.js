import _ from 'lodash';
import express from 'express';
import Promise from 'bluebird';
import URL from 'url';
import QueryString from 'qs';
import performanceNow from 'performance-now';
import Winston from 'winston';

const apiErrorsLogger = Winston.loggers.get('API_ERRORS');

const ApiPathPrefix = 'api';

//import Table from 'cli-table3';
//const printRoutes = _.once(routes => {
//    const table = new Table({head: ['', 'Name', 'Path']});
//
//    for (const key in routes) {
//        if (routes.hasOwnProperty(key)) {
//            let val = routes[key];
//            if (val.route) {
//                val = val.route;
//                table.push({
//                    [val.stack[0].method]: [val.path, val.path]
//                });
//            }
//        }
//    }
//
//    console.log('API Routes :');
//    console.log(table.toString());
//});

function wrap(req, res, apiHandler, apiObj, instanceName) {
    const startTime = performanceNow();

    const query = URL.parse(req.originalUrl).query;
    let queryObject = {};
    if (query && !_.isEmpty(query)) {
        queryObject = QueryString.parse(query, {allowDots: true});
    }
    
    req.params.__instanceName__ = instanceName;

    const data = _.extend({}, req.body, queryObject, req.params);

    let promise = null;
    try {
        const dataStr = JSON.stringify(data);

        // set req length in header for logging
        res.set('REQ_LENGTH', dataStr.length);
        promise = apiHandler.call(apiObj, req, data);
    } catch (error) {
        console.error('Error in handling request for data: ', JSON.stringify(data), req.originalUrl, error, error.stack);
        apiErrorsLogger.error(error);
        promise = Promise.reject(error);
    }

    return Promise.resolve(promise)
      .then((result) => {
          if (result) {
              result.requestTime = req.body.requestTime;
              result.serviceTimeTaken = (performanceNow() - startTime).toFixed(3);

              if (!_.isUndefined(result.queryTimeTaken)) {
                  res.header('QUERY_TIME_TAKEN', result.queryTimeTaken);
              }

              if (!_.isUndefined(result.totalResults)) {
                  res.header('TOTAL_RESULTS', result.totalResults);
              }

              res.set('Content-Type', 'application/json; charset=utf-8');
              const response = new Buffer(JSON.stringify(result), 'utf8');

              // set response length in header for logging
              res.header('RES_LENGTH', response.length);

              return res.send(response);
          }

          return res.json(result);
      })
      .catch((error) => {
          if (error && _.isObject(error)) {
              // TODO: change it
              error._errorId = Date.now();

              apiErrorsLogger.error(_.omit(error, 'stack'));

              return res.status(error._statusCode || 500).json(error._errorCode === 'INTERNAL_SERVICE_ERROR' ? _.omit(error, 'details') : error);
          }

          // log error stack here
          console.error('Error in handling request for data: ', JSON.stringify(data), req.originalUrl, error, error.stack);

          apiErrorsLogger.error(error);

          return res.status(500).json(error);
      });
}

function buildRoute(router, api, key, value, pathPrefix, instanceName) {
    let path = null;

    if (pathPrefix) {
        path = `${pathPrefix}/${key}`;
    } else {
        path = `/${ApiPathPrefix}/${key}`;
    }

    const method = _.lowerCase(value.method) || 'post';

    router[method](path, (req, res) => {
        wrap(req, res, value.handler, api, instanceName);
    });

    // emit event here
}

// should build a catch all route for pathPrefix ??
function buildRoutes(router, apiOrBuilder) {
    // if it's a builder function, build it...
    let pathPrefix = null;
    let api = null;
    let registry = null;
    let instanceName = null;
    if (_.isObject(apiOrBuilder)) {
        pathPrefix = apiOrBuilder.path;
        api = apiOrBuilder.api;
        registry = apiOrBuilder.registry;
        instanceName = apiOrBuilder.instanceName;
    } else {
        api = apiOrBuilder;
    }

    if (_.isFunction(api)) {
        api = api();
    }

    if (!registry && _.isFunction(api.registry)) {
        registry = api.registry();
    }

    if (!registry) {
        // print errors here
        return;
    }

    _.forEach(registry, (value, key) => {
        if (_.isArray(value)) {
            _.forEach(value, item => buildRoute(router, api, key, item, pathPrefix, instanceName));
        } else {
            buildRoute(router, api, key, value, pathPrefix, instanceName);
        }
    });
}

//function registerApi(app, api) {
//
//}
//
//function unRegisterApi(app, api) {
//
//}

export default (config) => {
    //if (config && config.watch) {
    //
    //}

    const router = express.Router();

    const apiOrApiArray = config.services;
    if (apiOrApiArray) {
        _.forEach(_.isArray(apiOrApiArray) ? apiOrApiArray : [apiOrApiArray], api => buildRoutes(router, api));
    }

    return router;
};