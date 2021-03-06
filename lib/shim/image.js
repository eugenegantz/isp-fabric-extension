'use strict';

const
	{ ispShimExtends } = require('./utils.js'),
	utils = {
		geometry: require('isp-geometry').utils.geometry
	};


function getImgRect(imgElem) {
	return {
		width: imgElem.width,
		height: imgElem.height
	}
}


module.exports = {

	crossOrigin: true,


	_ispImageContainToRect(from, to) {
		let rect = utils.geometry.containToRect({
			width: from.width,
			height: from.height
		}, {
			width: to.width,
			height: to.height
		});

		this.ispSetWidth(rect.width);
		this.ispSetHeight(rect.height);
	},


	ispReplaceImage(arg) {
		let { img }          = arg,
			originWidth      = this.ispGetWidth(),
			originHeight     = this.ispGetHeight();

		if (typeof img == 'string') {
			return fabric.util.loadImage(img, _imgElem => {
				this.ispReplaceImage(Object.assign({}, arg, { img: _imgElem }));
			}, {
				crossOrigin: true
			});
		}

		this.setElement(img);

		if ('contain' == arg.size) {
			this._ispImageContainToRect(getImgRect(img), {
				width: originWidth,
				height: originHeight
			});
		}

		setTimeout(() => {
			this.canvas.renderAll();

			arg.callback && arg.callback();
		}, 300);
	},


	init(fabric) {
		ispShimExtends(fabric.Image.prototype, this);
	}

};
