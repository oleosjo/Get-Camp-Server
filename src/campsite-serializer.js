'use strict';
var JSONAPISerializer = require('json-api-serializer');
const camelCase = require('camelcase');

function cleanJSON(json)  {
  let input = json.resultset.result;
  let output = [];

  output.parkId = `${json.resultset.$.contractCode}-${json.resultset.$.parkId}`;

  for (var i = 0; i < input.length; i++) {
    output[i] = {};
    output[i].id = `${json.resultset.$.contractCode}-${json.resultset.$.parkId}-${input[i].$['SiteId']}`;

    Object.keys(input[i].$).forEach(function(key) {
      output[i][camelCase(key)] = input[i].$[key];
    });

    output[i].campsiteDetail = { id: output[i].id }

  }
  return output;
}

module.exports = function(data) {
  let cleanData = cleanJSON(data);

  let Serializer = new JSONAPISerializer();

  Serializer.register('campsites', {
    topLevelLinks: {
      self: () => `/campsites?id=${cleanData.parkId}`
    },
    convertCase: 'kebab-case',
    relationships: {
      campsiteDetail: {
        type: 'campsite-detail',
        links: function(data) {
          return {
            related: `/campsite-details/${data.id}`
          }
        }
      }
    }
  });

  Serializer.register('campsite-detail');

  let jsonDoc = Serializer.serialize('campsites', cleanData);
  delete jsonDoc.included;
  return jsonDoc;
}
