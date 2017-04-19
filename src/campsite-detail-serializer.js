'use strict';
var JSONAPISerializer = require('json-api-serializer');
const camelCase = require('camelcase');

function cleanJSON(json, id)  {
    let attrs = {};
    attrs.id = id;

    if (json.campsite.photos[0]) {
      attrs['photoUrls'] = json.campsite.photos[0].photo.map(function(photo) {
        return photo.$.value;
      });
    } else {
      attrs['photoUrls'] = [];
    }


    json.campsite.attributes[0].attribute.forEach(function(attr) {
      attrs[camelCase(attr.$.attributeName)] = attr.$.attributeValue;
    });

    return attrs;
}

module.exports = function(data, id) {
  let cleanData = cleanJSON(data, id);

  let Serializer = new JSONAPISerializer();

  Serializer.register('campsite-detail', {
    convertCase: 'kebab-case'
  });

  return Serializer.serialize('campsite-detail', cleanData);
}
