'use strict';

const
	fabric = require('./../../index.js').getFabric(),
	ISPFabricPage = require('./isp-fabric-page.js'),

	utils = {
		geometry: require('isp-geometry').utils.geometry
	},

	_ = {
		get: require('lodash/get'),
		debounce: require('lodash/debounce')
	};

require('../shim/object.js');
require('../shim/image.js');
//require('./polyfills/i-text.js');
require('./isp-textbox.js');
require('./isp-shape-star-5.js');
require('./isp-shape-certificate.js');
require('./isp-shape-bookmark.js');
require('./isp-shape-heart.js');
require('./isp-shape-bubble.js');
require('./isp-shape-bubble-round.js');


const ISPFabricCanvas = fabric.util.createClass(fabric.Canvas, {

	type: 'ISPFabricCanvas',


	controlsAboveOverlay: true,


	preserveObjectStacking: true,


	ispDev: {

		// Показывать сетку + линейку
		grid: 0

	},


	/**
	 * Направляющие
	 * */
	ispGuidelines: {
		// Показывать статичные направляющие
		'static': true,

		// Динамические, магнитные
		smart: {
			// Модель рамки
			boxModel: 'bounding-box',

			// Цвет направляющих
			strokeStyle: '#ff4aff', // розовый

			// Падиус действия
			tolerance: 10,

			// Включить направляющие относительно вершин:
			vertex: [
				'tl',   // top-left
				'tr',   // top-right
				'c',    // center
				'bl',   // bottom-left
				'br'    // bottom-right
			],

			// Включить направляющие" относительно:
			snapTo: {
				page: true, // холста
				objects: true // объектов
			}
		}
	},


	/**
	 * Поднять текст на передний план
	 * */
	ispBringTextToFront: false,


	// TODO: MOV-288485. По неизвестынм причинам на мобильных устройствах нарушаются пропорции экрана
	enableRetinaScaling: false,


	_ispObjectCachingFalseObjTypes: {
		'i-text': 1,
		text: 1
	},


	_ispObjectCachingTrueObjTypes: {
		image: 1
	},


	initialize(el, options) {
		this.callSuper('initialize', el, options);

		this.setBackgroundColor('#cccccc');
		this.dpi = 300;
		this.ispPostRenderObjects = [];
		this._ispPostRenderGuideLines = [];

		this._ispInitEvents();

		this.ispClipByPageFn = this.ispClipByPageFn.bind(this);
		// this.ispClipByPage(true);

		this.ispOverlay = {
			canvas: document.createElement('canvas'),
		};

		this.ispOverlayObject = {
			canvas: document.createElement('canvas'),
		};

		this.ispOverlay.ctx = this.ispOverlay.canvas.getContext('2d');
		this.ispOverlayObject.ctx = this.ispOverlay.canvas.getContext('2d');
	},


	/**
	 * Проверить есть ли среди переданных объектов хотя бы один выделенный на холсте?
	 *
	 * @param {Array | Object} objects
	 *
	 * @return {Boolean}
	 * */
	ispSomeActiveObjects(objects) {
		objects = [].concat(objects || []);

		return this.getActiveObjects().some(obj => {
			return !!~objects.indexOf(obj);
		});
	},


	/**
	 * Проверить все ли переданные объекты выделены на холсте (выбраны)
	 *
	 * @param {Array | Object} objects
	 *
	 * @return {Boolean}
	 * */
	ispEveryActiveObjects(objects) {
		objects = [].concat(objects || []);

		return this.getActiveObjects().every(obj => {
			return !!~objects.indexOf(obj);
		});
	},


	/**
	 * Выбрать на холсте переданные объекты
	 *
	 * @param {Array} objects
	 * */
	ispSetActiveObjects(objects) {
		objects = [].concat(objects || []);

		let sel;

		this.discardActiveObject();

		if (!objects.length)
			return this.requestRenderAll();

		if (objects.length == 1) {
			sel = objects[0];

		} else {
			sel = new fabric.ActiveSelection(objects, { canvas: this });
		}

		this.setActiveObject(sel);
		this.requestRenderAll();
	},


	_ispInitEvents() {
		this.on('object:added', this._ispOnObjectAdded);
		this.on('text:changed', this._ispOnTextChanged);
		this.on('text:editing:exited', this._ispOnTextEditingExited);
		this.on('object:moving', this._ispOnObjectMoving);
		this.on('object:rotating', this._ispOnObjectRotating);
		this.on('object:scaling', this._ispOnObjectScaling);
		this.on('before:render', this._ispOnBeforeRender);
		this.on('after:render', this._ispOnAfterRender);
		this.on('after:render', this._ispOnAfterRenderPostRenderObjects);
		this.on('after:render', this._ispOnAfterRenderDevGrid);
		this.on('after:render', this._ispOnAfterRenderDrawSmartGuideLines);
	},


	_ispOnObjectRotating(obj) {
		if (obj.e.shiftKey)
			obj.target.angle = Math.round(obj.target.angle / 15) * 15;
	},


	_ispOnObjectMoving(e) {
		this._ispApplyGuidelines(e.target, _.get(this, 'ispGuidelines.smart'));
	},


	_ispOnObjectScaling() {
		return null;
	},


	_ispOnBeforeRender() {
		this.clearContext(this.contextTop);

		this.ispBeforeRenderObjects = null;

		if (this.ispBringTextToFront)
			this.ispBringToFrontTextHandler();

		let page        = this.ispGetPage(),
			pageClip    = page && page.clipPath;

		// clipPath не работает если объект-маска прозрачен
		if (pageClip) {
			pageClip._ispBeforeRenderOpacity = pageClip.get('opacity');
			pageClip.set({ opacity: pageClip.get('opacity') || 0.01 });
		}
	},


	_ispOnAfterRender() {
		this._objects = this.ispBeforeRenderObjects || this._objects;

		let page        = this.ispGetPage(),
		    pageClip    = page && page.clipPath;

		if (pageClip && '_ispBeforeRenderOpacity' in pageClip) {
			pageClip.set({ opacity: pageClip._ispBeforeRenderOpacity });

			delete pageClip._ispBeforeRenderOpacity;
		}
	},


	/**
	 * Обработчик. Подключается по усмотрению. Поднять текстовые слои на передний план
	 * */
	ispBringToFrontTextHandler() {
		this.ispBeforeRenderObjects = this.getObjects().slice(0);

		this.ispBringToFront([
			{ type: fabric.ISPTextbox.prototype.type },
			{ type: fabric.IText.prototype.type },
			{ type: fabric.Text.prototype.type },
		]);
	},


	_ispOnAfterRenderPostRenderObjects() {
		let obj,
		    ctx = this.getContext();

		while (obj = this.ispPostRenderObjects.shift()) {
			obj.render(ctx);
			obj._ispPostRenderAwait = void 0;
		}
	},


	_ispRenderDevGrid() {
		let x = 0,
			y = 0,
			i = 0,
			fontSize = 12,
			fontFamily = 'serif',
			_vpt = this.viewportTransform,
			ctx = this.getContext(),
			c = this,
			font = fontSize + ' ' + fontFamily,
			z = _vpt[0],
			step = 20 * z,
			ox = _vpt[4],
			oy = _vpt[5];

		ctx.save();

		// рулетка "ширина"
		while (i < c.width) {
			x = i + ox;

			ctx.strokeStyle = 'black';
			ctx.moveTo(x, 0);
			ctx.lineTo(x, 10);

			ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
			ctx.moveTo(x, 30);
			ctx.lineTo(x, c.height);


			ctx.rotate(Math.PI / 2);
			ctx.font = font;
			ctx.fillText(+((x - ox).toFixed(2)), 20, -x);
			ctx.rotate(-Math.PI / 2);

			i += step;
		}

		i = 0;

		// рулетка "высота"
		while (i < c.height) {
			y = i + oy;

			ctx.strokeStyle = 'black';
			ctx.moveTo(0, y);
			ctx.lineTo(10, y);

			ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
			ctx.moveTo(60, y);
			ctx.lineTo(c.width, y);

			ctx.font = font;
			ctx.fillText(+((y - oy).toFixed(2)), 20, y);

			i += step;
		}

		ctx.stroke();
		ctx.restore();
	},


	_ispOnAfterRenderDrawSmartGuideLines: _.debounce(function() {
		let obj;

		while (obj = this._ispPostRenderGuideLines.shift()) {
			this._ispDrawSmartGuideLine(obj.line[0], obj.line[1]);
			this._ispDrawSmartGuideLine(obj.line[1], obj.point);
		}
	}, 50),


	_ispOnAfterRenderDevGrid() {
		this.ispDev.grid && this._ispRenderDevGrid();
	},


	ispAddPostRenderObject(obj) {
		obj._ispPostRenderAwait = 1;

		this.ispPostRenderObjects.push(obj);
	},


	ispIsPostRenderObject(obj) {
		return !!obj._ispPostRenderAwait;
	},


	_ispOnObjectAdded(e) {
		let bgImg = this.backgroundImage,
			obj = e.target;

		// this._ispSetDefaultOrigin(obj);

		this._ispApplyIdToObj(obj);

		this.lockCanvasObject(obj, this.isObjectLocked(obj));

		if (this._ispObjectCachingFalseObjTypes[obj.type])
			obj.set('objectCaching', false);

		if (this._ispObjectCachingTrueObjTypes[obj.type])
			obj.set('objectCaching', true);

		this.lockCanvasObject(obj, obj.locked);

		// ---
		if (bgImg && bgImg.clipPath && bgImg.clipPath.id == obj.id) {
			bgImg.clipPath = obj;
			obj.absolutePositioned = true;
		}
	},


	_ispOnTextChanged(e) {
		this._measureText(e.target);
	},


	_ispOnTextEditingExited(e) {
		setTimeout(() => !e.target.text && this.ispRmObjects(e.target), 0);
	},


	/**
	 * Вернуть обработчики событий
	 *
	 * @param eventName - название события
	 *
	 * @return {Array}
	 * */
	ispGetEventListeners(eventName) {
		return this.__eventListeners[eventName] || [];
	},


	/**
	 * Поднять указанные объекты на передний план
	 *
	 * @param arg - параметры для ispGetObjects
	 * */
	ispBringToFront(arg) {
		this.ispGetObjects(arg).reduceRight((arr, obj) => this.bringToFront(obj), null);
	},


	/**
	 * Костыль. Нужен для того, чтобы указать экземпляр холста в котором работает backgroundImage
	 * */
	__setBgOverlay(property, value, loaded, callback) {
		return this.callSuper('__setBgOverlay', property, value, loaded, () => {
			if ('backgroundImage' == property && value)
				this.ispSetPage(value);

			callback && callback();
		});
	},


	toObject(props) {
		if (!props)
			props = [];

		props.push.apply(props, ['id', 'dpi', 'objectCaching', 'ispBackgroundImage', 'ispBringTextToFront']);

		return this.callSuper('toObject', props);
	},


	/**
	 * Установить печатную область
	 *
	 * @param {ISPFabricPage} page
	 *
	 * @return {ISPFabricCanvas}
	 * */
	ispSetPage(page) {
		if (!(page instanceof ISPFabricPage))
			page = new ISPFabricPage(page);

		page.canvas = page.canvas || this;

		return this.setBackgroundImage(page);
	},


	ispGetPageRect() {
		let page = this.ispGetPage(),
			scrollCoords = this.ispGetScrollCoord(),
			z = this.getZoom();

		if (!page) {
			return {
				left: 0,
				top: 0,
				width: 0,
				height: 0
			}
		}

		return {
			left: scrollCoords.x,
			top: scrollCoords.y,
			width: page.ispGetWidth() * z,
			height: page.ispGetHeight() * z
		}
	},


	ispClipByPageFn(ctx) {
		let { left, top, width, height } = this.ispGetPageRect();

		ctx.rect(left, top, width, height);
	},


	/**
	 * Включить режим предпросмотра (видно только печатную область)
	 *
	 * @param {Boolean} active
	 * */
	ispClipByPage(active) {
		let page = this.ispGetPage();

		if (!page)
			return;

		page.absolutePositioned = true;

		this.clipPath = active
			? page
			: void 0;
	},


	/**
	 * Автоматически рассчитать и установить коэф. увеличения
	 * */
	ispSetAutoZoom() {
		let page = this.ispGetPage();

		if (!page) return;

		let pageSize = {
			width: this.ispGetPage().ispGetWidth(),
			height: this.ispGetPage().ispGetHeight()
		};

		let canvasSize = {
			height: this.getHeight(),
			width: this.getWidth()
		};

		let res = utils.geometry.containToRect(pageSize, canvasSize);

		this.setZoom((res.width / pageSize.width) * 0.8);
	},


	/**
	 * Сместить положение прокрутки на холсте
	 *
	 * @param stepX - смещение по горизонтали
	 * @param stepY - смещение по вертиткали
	 *
	 * @return {ISPFabricCanvas}
	 * */
	ispScrollBy(stepX, stepY) {
		let vpt = this.get('viewportTransform'),
			page = this.ispGetPage();

		if (!page) return;

		vpt[4] += stepX;
		vpt[5] += stepY;

		return this.setViewportTransform(vpt);
	},


	/**
	 * Установить положение прокрутки на указанные координаты
	 *
	 * @param xCoord - смещение по горизонтали
	 * @param yCoord - смещение по вертиткали
	 *
	 * @return {ISPFabricCanvas}
	 * */
	ispScrollTo(xCoord, yCoord) {
		let vpt = this.get('viewportTransform'),
			page = this.ispGetPage();

		if (!page) return;

		vpt[4] = xCoord;
		vpt[5] = yCoord;

		return this.setViewportTransform(vpt);
	},


	/**
	 * Вернуть текущее смещение холста (прокрутки)
	 *
	 * @return {Object} - { x, y }
	 * */
	ispGetScrollCoord() {
		let vpt = this.get('viewportTransform');

		return {
			x: vpt[4],
			y: vpt[5]
		};
	},


	/**
	 * Вмещается ли печатная область в видимую рабочую область
	 *
	 * @return {Boolean}
	 * */
	ispIsPageFitToCanvasViewport() {
		let z = this.getZoom(),
			page = this.ispGetPage();

		if (!page) return;

		return (
			   this.getWidth() - (page.ispGetWidth() * z) > 0
			&& this.getHeight() - (page.ispGetHeight() * z) > 0
		)
	},


	/**
	 * Центрировать печатную область по горизонтали
	 * */
	ispPageAlignToCenterH() {
		let vpt = this.get('viewportTransform'),
			page = this.ispGetPage();

		if (!page) return;

		vpt[4] = this.getCenter().left - (page.get('width') * this.getZoom() / 2);

		this.setViewportTransform(vpt);

		return this;
	},


	/**
	 * Центрировать печатную область по вертикали
	 * */
	ispPageAlignToCenterV() {
		let vpt = this.get('viewportTransform'),
			page = this.ispGetPage();

		if (!page) return;

		vpt[5] = this.getCenter().top - (page.get('height') * this.getZoom() / 2);

		this.setViewportTransform(vpt);

		return this;
	},


	/**
	 * Вернуть печатную область
	 *
	 * @return {ISPFabricPage}
	 * */
	ispGetPage() {
		return this.backgroundImage;
	},


	_ispApplyIdToObj(obj) {
		obj.id = obj.id || obj.ispCreateUniqueId();
	},


	_ispSetDefaultOrigin(obj) {
		obj.set({
			originX: 'center',
			originY: 'center',
			left: obj.left + obj.width / 2,
			top: obj.top + obj.height / 2
		});
	},


	/**
	 * Заблокировать объект
	 *
	 * @param {fabric.Object} obj - объект из холста
	 * @param {Boolean} lock - состояние блокировки
	 *
	 * @return {ISPFabricCanvas}
	 * */
	lockCanvasObject(obj, lock) {
		obj.set({
			lockMovementX: lock,
			lockMovementY: lock,
			lockScalingX: lock,
			lockScalingY: lock,
			lockUniScaling: lock,
			lockRotation: lock,
			selectable: !lock,
			hasControls: !lock,
			hasBorders: !lock,
			editable: !lock
		});

		obj.locked = lock;

		return this;
	},


	/**
	 * Проверить состояние блокировки объекта
	 *
	 * @param {Object} obj
	 *
	 * @return {Boolean}
	 * */
	isObjectLocked(obj) {
		return obj.locked || false;
	},


	/**
	 * Пересчитать размер текста
	 * */
	_measureText: _.debounce(function(obj) {
		if (!('i-text' == obj.type || 'text' == obj.type))
			return;

		let ctx = obj.getMeasuringContext();

		ctx.font = `${obj.fontSize}px ${obj.fontFamily}`;

		let line = obj.text.split('\n').reduce((prevLine, nextLine) => {
			return nextLine.length > prevLine.length ? nextLine : prevLine;
		});

		obj.width = ctx.measureText(line).width;

		this.renderAll();
	}, 500),


	_renderOverlay(e) {
		let page = this.ispGetPage();

		if (!page)
			return null;

		let _page       = page.clipPath || page,
		    width       = this.getWidth(),
		    height      = this.getHeight(),
		    fillStyle   = page.clipPath ? "rgba(0, 0, 0, 0.8)" : "rgba(0, 0, 0, 0.45)";

		_page.cacheWidth = 0;
		_page.cacheHeight = 0;

		this.ispOverlay.canvas.width = this.width;
		this.ispOverlay.canvas.height = this.height;
		this.ispOverlayObject.canvas.width = this.width;
		this.ispOverlayObject.canvas.height = this.height;

		this.ispOverlay.ctx.save();
		// this.ispOverlay.ctx.globalCompositeOperation = "source-atop";
		this.ispOverlay.ctx.beginPath();
		this.ispOverlay.ctx.moveTo(-2, -2);
		this.ispOverlay.ctx.lineTo(width + 2, -2);
		this.ispOverlay.ctx.lineTo(width + 2, height + 2);
		this.ispOverlay.ctx.lineTo(-2, height + 2);
		this.ispOverlay.ctx.lineTo(-2, -2);
		this.ispOverlay.ctx.transform.apply(this.ispOverlay.ctx, this.viewportTransform);
		// ---
		// this.ispOverlay.ctx.moveTo(0, 0);
		// this.ispOverlay.ctx.lineTo(0, t.ispGetHeight());
		// this.ispOverlay.ctx.lineTo(t.ispGetWidth(), t.ispGetHeight());
		// this.ispOverlay.ctx.lineTo(t.ispGetWidth(), 0);
		// ---
		this.ispOverlay.ctx.closePath();
		this.ispOverlay.ctx.fillStyle = fillStyle;
		this.ispOverlay.ctx.fill();
		this.ispOverlay.ctx.restore();
		// ------
		this.ispOverlayObject.ctx.save();
		this.ispOverlayObject.ctx.transform.apply(this.ispOverlay.ctx, this.viewportTransform);
		this.ispOverlay.ctx.globalCompositeOperation = 'destination-out';
		_page.transform(this.ispOverlayObject.ctx);
		_page.transformMatrix && ctx.transform.apply(this.ispOverlayObject.ctx, _page.transformMatrix);
		_page.drawObject(this.ispOverlayObject.ctx, true);
		this.ispOverlay.ctx.drawImage(this.ispOverlayObject.canvas, 0, 0);
		this.ispOverlayObject.ctx.restore();
		// ------
		e.drawImage(this.ispOverlay.canvas, 0, 0);
	},


	_ispDrawSmartGuideLine: function(p1, p2) {
		let ctx = this.contextTop,
		    vpt = this.viewportTransform,
		    z = vpt[0];

		ctx.save();
		ctx.setTransform(1, 0, 0, 1, vpt[4], vpt[5]);
		ctx.globalAlpha = 1;
		ctx.beginPath();
		ctx.strokeStyle = _.get(this, 'ispGuidelines.smart.strokeStyle') || 'pink';
		ctx.strokeWidth = _.get(this, 'ispGuidelines.smart.strokeWidth') || 1;
		ctx.moveTo(p1.x * z, p1.y * z);
		ctx.lineTo(p2.x * z, p2.y * z);
		ctx.stroke();
		ctx.closePath();
		ctx.restore();
	},


	_ispApplyGuidelines(obj, opt = {}) {
		let gl = this._ispPostRenderGuideLines,
		    _static = _.get(this, 'ispGuidelines.static'),
		    _smart = _.get(this, 'ispGuidelines.smart'),
		    page = this.ispGetPage();

		gl.splice(0, gl.length);

		if (_.get(_smart, 'snapTo.page'))
			gl.push.apply(gl, obj.ispSmartGuideToObject(page, opt));

		this.getObjects().forEach(o => {
			if (obj == o)
				return;

			if ('activeSelection' == obj.type) {
				if (obj.getObjects().some(o2 => o2 == o))
					return;

			} else if ('ISPFabricGuideline' == o.type) {
				if (!_static)
					return;

			} else if (!_.get(_smart, 'snapTo.objects')) {
				return;
			}

			gl.push.apply(gl, obj.ispSmartGuideToObject(o, opt));
		});
	},


	/**
	 * Переопределение метода устраняет проблемы:
	 * - падает renderAll так как нативный метод не парсит clipPath для backgroundImage
	 * - после десериализации экземпляр маски внутри объекта отличен от экземпляра маски на холсте
	 */
	loadFromJSON(json, callback, reviver) {
		let objectsById         = {},
		    objectsByClipPathId = {};

		let objectHandler = (o, obj) => {
			if (!obj)
				return;

			objectsById[obj.id] = obj;

			if (obj.clipPath) {
				objectsByClipPathId[obj.clipPath.id] = obj;

				obj.clipPath = objectsById[obj.clipPath.id] || obj.clipPath;
				obj.clipPath.absolutePositioned = true;
			}

			if (objectsByClipPathId[obj.id])
				objectsByClipPathId[obj.id].clipPath = obj;

			let bgImg       = this.backgroundImage,
			    bgClipPath  = bgImg && bgImg.clipPath;

			if (obj && bgClipPath && bgClipPath.id == obj.id)
				bgImg.clipPath = obj;

			if (obj.getObjects)
				obj.getObjects().forEach(obj => objectHandler(obj, obj));
		};

		let _reviver = (o, obj, error) => {
			objectHandler(o, obj, error);

			reviver && reviver(o, obj, error);
		};

		this.callSuper('loadFromJSON', json, callback, _reviver);
	},


});


module.exports = ISPFabricCanvas;
