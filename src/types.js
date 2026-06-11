/**
 * @typedef {"success"|"partial"|"failed"|"manual_required"|"blocked"|"unsupported"|"collecting"} FetchStatus
 * @typedef {"high"|"medium"|"low"} Confidence
 *
 * @typedef {Object} TireSpec
 * @property {string} width
 * @property {string} aspectRatio
 * @property {string} rim
 *
 * @typedef {Object} TireSearchInput
 * @property {string=} vehicleName
 * @property {TireSpec} frontSpec
 * @property {TireSpec=} rearSpec
 * @property {string} keyword
 * @property {string=} brand
 * @property {string=} modelName
 * @property {string=} region
 * @property {number} frontQuantity
 * @property {number} rearQuantity
 * @property {boolean} preferInstallIncluded
 *
 * @typedef {Object} PlatformTireItem
 * @property {string} id
 * @property {string} platformName
 * @property {string} productName
 * @property {string=} brand
 * @property {string=} modelName
 * @property {string=} spec
 * @property {number=} unitPrice
 * @property {number=} quantity
 * @property {number=} installationFee
 * @property {number=} shippingFee
 * @property {number=} discount
 * @property {number=} totalPrice
 * @property {boolean=} installIncluded
 * @property {string=} shopName
 * @property {string=} shopAddress
 * @property {string=} availableDate
 * @property {string=} productUrl
 * @property {string} collectedAt
 * @property {Confidence} confidence
 * @property {string=} memo
 * @property {boolean=} manual
 *
 * @typedef {Object} PlatformFetchResult
 * @property {string} platformName
 * @property {string} searchUrl
 * @property {FetchStatus} status
 * @property {PlatformTireItem[]} items
 * @property {string=} errorMessage
 * @property {boolean=} excluded
 */

export {};
