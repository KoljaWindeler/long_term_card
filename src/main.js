import { LitElement, html, svg } from 'lit-element';
import Graph from './graph';
import style from './style';
import handleClick from './handleClick';

import {
  URL_DOCS,
  FONT_SIZE,
  FONT_SIZE_HEADER,
  MAX_BARS,
  ICONS,
  DEFAULT_COLORS,
  UPDATE_PROPS,
  DEFAULT_SHOW,
  X, Y, V,
} from './const';
import {
  getMin,
  getAvg,
  getMax,
  getTime,
  getMilli,
  interpolateColor,
  compress, decompress,
  getFirstDefinedItem,
  compareArray,
} from './utils';

function parseDate(eventDate,formater){
	const normalizedFormat= formater.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-');
	const formatItems     = normalizedFormat.split('-');
	const monthIndex  = formatItems.indexOf("mm");
	const dayIndex    = formatItems.indexOf("dd");
	const yearIndex   = formatItems.indexOf("yyyy");
	const hourIndex     = formatItems.indexOf("hh");
	const minutesIndex  = formatItems.indexOf("ii");
	const secondsIndex  = formatItems.indexOf("ss");
	const today = new Date();
	// variable format date parseing

	var normalized      = eventDate.replace(/[^a-zA-Z0-9]/g, '-');
	var dateItems       = normalized.split('-');
	var year  = yearIndex>-1  ? dateItems[yearIndex]    : today.getFullYear();
	var month = monthIndex>-1 ? dateItems[monthIndex]-1 : today.getMonth()-1;
	var day   = dayIndex>-1   ? dateItems[dayIndex]     : today.getDate();
	var hour    = hourIndex>-1      ? dateItems[hourIndex]    : 0;
	var minute  = minutesIndex>-1   ? dateItems[minutesIndex] : 0;
	var second  = secondsIndex>-1   ? dateItems[secondsIndex] : 0;
	return new Date(year,month,day,hour,minute,second);
	// variable format date parseing
}

class MiniGraphCard extends LitElement {
  constructor() {
    super();
    this.id = Math.random()
      .toString(36)
      .substr(2, 9);
    this.config = {};
    this.bound = [0, 0];
    this.boundSecondary = [0, 0];
    this.min = {};
    this.avg = {};
    this.max = {};
    this.length = [];
    this.entity = [];
    this.line = [];
    this.bar = [];
    this.data = [];
    this.fill = [];
    this.points = [];
    this.gradient = [];
    this.display_mode = '';
    this.data_delimiter = '';
    this.data_delimiter = '';
    this.tooltip = {};
    this.updateQueue = [];
    this.updating = false;
    this.stateChanged = false;
  }

  static get styles() {
    return style;
  }

  set hass(hass) {
    this._hass = hass;
    let updated = false;
    this.config.entities.forEach((entity, index) => {
      this.config.entities[index].index = index; // Required for filtered views
      const entityState = hass.states[entity.entity];
      if (entityState && this.entity[index] !== entityState) {
        this.entity[index] = entityState;
        this.updateQueue.push(entityState.entity_id);
        updated = true;
      }
    });
    if (updated) {
      this.entity = [...this.entity];
      if (!this.config.update_interval && !this.updating) {
        this.updateData();
      } else {
        this.stateChanged = true;
      }
    }
  }

  static get properties() {
    return {
      id: String,
      _hass: {},
      config: {},
      entity: [],
      Graph: [],
      line: [],
      shadow: [],
      length: Number,
      bound: [],
      boundSecondary: [],
      abs: [],
      tooltip: {},
      updateQueue: [],
      color: String,
    };
  }

  setConfig(config) {
    if (config.entity)
      throw new Error(`The "entity" option was removed, please use "entities".\n See ${URL_DOCS}`);
    if (!Array.isArray(config.entities))
      throw new Error(`Please provide the "entities" option as a list.\n See ${URL_DOCS}`);
    if (config.line_color_above || config.line_color_below)
      throw new Error(
        `"line_color_above/line_color_below" was removed, please use "color_thresholds".\n See ${URL_DOCS}`,
      );

    const conf = {
      animate: false,
      hour24: false,
      font_size: FONT_SIZE,
      font_size_header: FONT_SIZE_HEADER,
      height: 100,
      hours_to_show: 24*7,
      points_per_hour: 1/24,
      aggregate_func: 'avg',
      group_by: 'date',
      line_color: [...DEFAULT_COLORS],
      color_thresholds: [],
      color_thresholds_transition: 'smooth',
      line_width: 5,
      compress: false,
      smoothing: false,
      maxDays: 30,
      formater: 'dd.mm.yyyy',
      display_mode: 'abs',
      data_delimiter: ';',
      data_field: 1,
      state_map: [],
      tap_action: {
        action: 'more-info',
      },
      ...JSON.parse(JSON.stringify(config)),
      show: { ...DEFAULT_SHOW, ...config.show },
    };

    conf.entities.forEach((entity, i) => {
      if (typeof entity === 'string') conf.entities[i] = { entity };
    });

    conf.state_map.forEach((state, i) => {
      // convert string values to objects
      if (typeof state === 'string') conf.state_map[i] = { value: state, label: state };
      // make sure label is set
      conf.state_map[i].label = conf.state_map[i].label || conf.state_map[i].value;
    });

    if (typeof config.line_color === 'string')
      conf.line_color = [config.line_color, ...DEFAULT_COLORS];

    conf.font_size = (config.font_size / 100) * FONT_SIZE || FONT_SIZE;
    conf.color_thresholds = this.computeThresholds(
      conf.color_thresholds,
      conf.color_thresholds_transition,
    );
    const additional = conf.hours_to_show > 24 ? { day: 'numeric', weekday: 'short' } : {};
    conf.format = { hour12: !conf.hour24, ...additional };

    // override points per hour to mach group_by function
    switch (conf.group_by) {
      case 'date':
        conf.points_per_hour = 1 / 24;
        break;
      case 'hour':
        conf.points_per_hour = 1;
        break;
      default:
        break;
    }

    if (conf.show.graph === 'bar') {
      const entities = conf.entities.length;
      if (conf.hours_to_show * conf.points_per_hour * entities > MAX_BARS) {
        conf.points_per_hour = MAX_BARS / (conf.hours_to_show * entities);
        // eslint-disable-next-line no-console
        console.warn(
          'long-term-card: Not enough space, adjusting points_per_hour to ',
          conf.points_per_hour,
        );
      }
    }

    const entitiesChanged = !compareArray(this.config.entities || [], conf.entities);

    this.config = conf;

    if (!this.Graph || entitiesChanged) {
      if (this._hass) this.hass = this._hass;
      this.Graph = conf.entities.map(
        entity => new Graph(
          500,
          conf.height,
          [conf.show.fill ? 0 : conf.line_width, conf.line_width],
          conf.hours_to_show,
          conf.points_per_hour,
          entity.aggregate_func || conf.aggregate_func,
          conf.group_by,
          getFirstDefinedItem(
            entity.smoothing,
            config.smoothing,
            !entity.entity.startsWith('binary_sensor.'), // turn off for binary sensor by default
          ),
        ),
      );
    }
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.config.update_interval) {
      this.updateOnInterval();
      this.interval = setInterval(
        () => this.updateOnInterval(),
        this.config.update_interval * 1000,
      );
    }
  }

  disconnectedCallback() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    super.disconnectedCallback();
  }

  shouldUpdate(changedProps) {
    if (!this.entity[0]) return false;
    if (UPDATE_PROPS.some(prop => changedProps.has(prop))) {
      this.color = this.intColor(
        this.tooltip.value !== undefined ? this.tooltip.value : this.entity[0].state,
        this.tooltip.entity || 0,
      );
      return true;
    }
  }

  updated(changedProperties) {
    if (this.config.animate && changedProperties.has('line')) {
      if (this.length.length < this.entity.length) {
        this.shadowRoot.querySelectorAll('svg path.line').forEach((ele) => {
          this.length[ele.id] = ele.getTotalLength();
        });
        this.length = [...this.length];
      } else {
        this.length = Array(this.entity.length).fill('none');
      }
    }
  }

  render({ config } = this) {
    return html`
      <ha-card
        class="flex"
        ?group=${config.group}
        ?fill=${config.show.graph && config.show.fill}
        ?points=${config.show.points === 'hover'}
        ?labels=${config.show.labels === 'hover'}
        ?labels-secondary=${config.show.labels_secondary === 'hover'}
        ?gradient=${config.color_thresholds.length > 0}
        ?hover=${config.tap_action.action !== 'none'}
        style="font-size: ${config.font_size}px;"
        @click=${e => this.handlePopup(e, this.entity[0])}
      >
        ${this.renderHeader()} ${this.renderStates()} ${this.renderGraph()} ${this.renderInfo()}
      </ha-card>
    `;
  }

  renderHeader() {
    const {
      show, align_icon, align_header, font_size_header,
    } = this.config;
    return show.name || (show.icon && align_icon !== 'state')
      ? html`
          <div class="header flex" loc=${align_header} style="font-size: ${font_size_header}px;">
            ${this.renderName()} ${align_icon !== 'state' ? this.renderIcon() : ''}
          </div>
        `
      : '';
  }

  renderIcon() {
    const { icon, icon_adaptive_color } = this.config.show;
    return icon ? html`
      <div class="icon" loc=${this.config.align_icon}
        style=${icon_adaptive_color ? `color: ${this.color};` : ''}>
        <ha-icon .icon=${this.computeIcon(this.entity[0])}></ha-icon>
      </div>
    ` : '';
  }

  renderName() {
    if (!this.config.show.name) return;
    const name = this.config.name || this.computeName(0);
    const color = this.config.show.name_adaptive_color ? `opacity: 1; color: ${this.color};` : '';

    return html`
      <div class="name flex">
        <span class="ellipsis" style=${color}>${name}</span>
      </div>
    `;
  }

  renderStates() {
    const { entity, value } = this.tooltip;
    const state = value !== undefined ? value : this.entity[0].state;
    const color = this.config.entities[0].state_adaptive_color ? `color: ${this.color};` : '';
    if (this.config.show.state)
      return html`
        <div class="states flex" loc=${this.config.align_state}>
          <div class="state">
            <span class="state__value ellipsis" style=${color}>
              ${this.computeState(state)}
            </span>
            <span class="state__uom ellipsis" style=${color}>
              ${this.computeUom(entity || 0)}
            </span>
            ${this.renderStateTime()}
          </div>
          <div class="states--secondary">${this.config.entities.map((ent, i) => this.renderState(ent, i))}</div>
          ${this.config.align_icon === 'state' ? this.renderIcon() : ''}
        </div>
      `;
  }

  renderState(entity, id) {
    if (entity.show_state && id !== 0) {
      const { state } = this.entity[id];
      return html`
        <div
          class="state state--small"
          @click=${e => this.handlePopup(e, this.entity[id])}
          style=${entity.state_adaptive_color ? `color: ${this.computeColor(state, id)};` : ''}>
          ${entity.show_indicator ? this.renderIndicator(state, id) : ''}
          <span class="state__value ellipsis">
            ${this.computeState(state)}
          </span>
          <span class="state__uom ellipsis">
            ${this.computeUom(id)}
          </span>
        </div>
      `;
    }
  }

  renderStateTime() {
    if (this.tooltip.value === undefined) return;
    return html`
      <div class="state__time">
        ${this.tooltip.label ? html`
          <span>${this.tooltip.label}</span>
        ` : html`
          <span>${this.tooltip.time[0]}</span>
        `}
      </div>
    `;
  }

  renderGraph() {
    return this.config.show.graph ? html`
      <div class="graph">
        <div class="graph__container">
          ${this.renderLabels()}
          ${this.renderLabelsSecondary()}
          <div class="graph__container__svg">
            ${this.renderSvg()}
          </div>
        </div>
        ${this.renderLegend()}
      </div>` : '';
  }

  renderLegend() {
    if (this.visibleLegends.length <= 1 || !this.config.show.legend) return;
    return html`
      <div class="graph__legend">
        ${this.visibleLegends.map(entity => html`
          <div class="graph__legend__item"
            @click=${e => this.handlePopup(e, this.entity[entity.index])}
            @mouseover=${() => this.setTooltip(entity.index, -1, this.entity[entity.index].state, 'Current')}
            >
            ${this.renderIndicator(this.entity[entity.index].state, entity.index)}
            <span class="ellipsis">${this.computeName(entity.index)}</span>
          </div>
        `)}
      </div>
    `;
  }

  renderIndicator(state, index) {
    return svg`
      <svg width='10' height='10'>
        <rect width='10' height='10' fill=${this.intColor(state, index)} />
      </svg>
    `;
  }

  renderSvgFill(fill, i) {
    if (!fill) return;
    const fade = this.config.show.fill === 'fade';
    return svg`
      <defs>
        <linearGradient id=${`fill-grad-${this.id}-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop stop-color='white' offset='0%' stop-opacity='1'/>
          <stop stop-color='white' offset='100%' stop-opacity='.15'/>
        </linearGradient>
        <mask id=${`fill-grad-mask-${this.id}-${i}`}>
          <rect width="100%" height="100%" fill=${`url(#fill-grad-${this.id}-${i})`} />
        </mask>
      </defs>
      <mask id=${`fill-${this.id}-${i}`}>
        <path class='fill'
          type=${this.config.show.fill}
          .id=${i} anim=${this.config.animate} ?init=${this.length[i]}
          style="animation-delay: ${this.config.animate ? `${i * 0.5}s` : '0s'}"
          fill='white'
          mask=${fade ? `url(#fill-grad-mask-${this.id}-${i})` : ''}
          d=${this.fill[i]}
        />
      </mask>`;
  }

  renderSvgLine(line, i) {
    if (!line) return;

    const path = svg`
      <path
        class='line'
        .id=${i}
        anim=${this.config.animate} ?init=${this.length[i]}
        style="animation-delay: ${this.config.animate ? `${i * 0.5}s` : '0s'}"
        fill='none'
        stroke-dasharray=${this.length[i] || 'none'} stroke-dashoffset=${this.length[i] || 'none'}
        stroke=${'white'}
        stroke-width=${this.config.line_width}
        d=${this.line[i]}
      />`;

    return svg`
      <mask id=${`line-${this.id}-${i}`}>
        ${path}
      </mask>
    `;
  }

  renderSvgPoint(point, i) {
    const color = this.gradient[i] ? this.computeColor(point[V], i) : 'inherit';
    return svg`
      <circle
        class='line--point'
        ?inactive=${this.tooltip.index !== point[3]}
        style=${`--mcg-hover: ${color};`}
        stroke=${color}
        fill=${color}
        cx=${point[X]} cy=${point[Y]} r=${this.config.line_width}
        @mouseover=${() => this.setTooltip(i, point[3], point[V])}

      />
    `;
  }

  renderSvgPoints(points, i) {
    if (!points) return;
    const color = this.computeColor(this.entity[i].state, i);
    return svg`
      <g class='line--points'
        ?tooltip=${1==1}
        ?init=${this.length[i]}
        anim=${this.config.animate && this.config.show.points !== 'hover'}
        style="animation-delay: ${this.config.animate ? `${i * 0.5 + 0.5}s` : '0s'}"
        fill=${color}
        stroke=${color}
        stroke-width=${this.config.line_width / 2}>
        ${points.map(point => this.renderSvgPoint(point, i))}
      </g>`;
  }

  renderSvgGradient(gradients) {
    if (!gradients) return;
    const items = gradients.map((gradiemaxDaysnt, i) => {
      if (!gradient) return;
      return svg`
        <linearGradient id=${`grad-${this.id}-${i}`} gradientTransform="rotate(90)">
          ${gradient.map(stop => svg`
            <stop stop-color=${stop.color} offset=${`${stop.offset}%`} />
          `)}
        </linearGradient>`;
    });
    return svg`${items}`;
  }

  renderSvgLineRect(line, i) {
    if (!line) return;
    const fill = this.gradient[i]
      ? `url(#grad-${this.id}-${i})`
      : this.computeColor(this.entity[i].state, i);
    return svg`
      <rect class='line--rect'
        ?id=${`rect-${this.id}-${i}`}
        fill=${fill} height="100%" width="100%"
        mask=${`url(#line-${this.id}-${i})`}
      />`;
  }

  renderSvgFillRect(fill, i) {
    if (!fill) return;
    const svgFill = this.gradient[i]
      ? `url(#grad-${this.id}-${i})`
      : this.intColor(this.entity[i].state, i);
    return svg`
      <rect class='fill--rect'
        ?inactive=${this.tooltip.entity !== undefined && this.tooltip.entity !== i}
        id=${`fill-rect-${this.id}-${i}`}
        fill=${svgFill} height="100%" width="100%"
        mask=${`url(#fill-${this.id}-${i})`}
      />`;
  }

  renderSvgBars(bars, index) {
    if (!bars) return;
    const items = bars.map((bar, i) => {
      const animation = this.config.animate
        ? svg`
          <animate attributeName='y' from=${this.config.height} to=${bar.y} dur='1s' fill='remove'
            calcMode='spline' keyTimes='0; 1' keySplines='0.215 0.61 0.355 1'>
          </animate>`
        : '';
      const color = this.computeColor(bar.value, index);
      return svg`
        <rect class='bar' x=${bar.x} y=${bar.y}
          height=${bar.height} width=${bar.width} fill=${color}
          @mouseover=${() => this.setTooltip(index, i, bar.value)}
          >
          ${animation}
        </rect>`;
    });
    return svg`<g class='bars' ?anim=${this.config.animate}>${items}</g>`;
  }

  renderSvg() {
    const { height } = this.config;
    return svg`
      <svg width='100%' height=${height !== 0 ? '100%' : 0} viewBox='0 0 500 ${height}'
        @click=${e => e.stopPropagation()}>
        <g>
          <defs>
            ${this.renderSvgGradient(this.gradient)}
          </defs>
          ${this.fill.map((fill, i) => this.renderSvgFill(fill, i))}
          ${this.fill.map((fill, i) => this.renderSvgFillRect(fill, i))}
          ${this.line.map((line, i) => this.renderSvgLine(line, i))}
          ${this.line.map((line, i) => this.renderSvgLineRect(line, i))}
          ${this.bar.map((bars, i) => this.renderSvgBars(bars, i))}
        </g>
        ${this.points.map((points, i) => this.renderSvgPoints(points, i))}
      </svg>`;
  }

  setTooltip(entity, index, value, label = null) {
    const {
      points_per_hour,
      hours_to_show,
      format,
    } = this.config;


    const offset = hours_to_show < 1 && points_per_hour < 1
      ? points_per_hour * hours_to_show
      : 1 / points_per_hour;
    const id = Math.abs(index + 1 - Math.ceil(hours_to_show * points_per_hour));
    const now = this.getEndDate();
		const oneMinInHours = 1 / 60;
    now.setMilliseconds(now.getMilliseconds() - getMilli(offset * id + oneMinInHours));
    const end = getTime(now, { hour12: !this.config.hour24 }, this._hass.language);
		var start = end;//
		if(this.data.length>index){
			start = this.data[index].last_changed_org;
		}

    this.tooltip = {
      value,
      id,
      entity,
      time: [start, end],
      index,
      label,
    };
  }

  renderLabels() {
    if (!this.config.show.labels || this.primaryYaxisSeries.length === 0) return;
    return html`
      <div class="graph__labels --primary flex">
        <span class="label--max">${this.computeState(this.bound[1])}</span>
        <span class="label--min">${this.computeState(this.bound[0])}</span>
      </div>
    `;
  }

  renderLabelsSecondary() {
    if (!this.config.show.labels_secondary || this.secondaryYaxisSeries.length === 0) return;
    return html`
      <div class="graph__labels --secondary flex">
        <span class="label--max">${this.computeState(this.boundSecondary[1])}</span>
        <span class="label--min">${this.computeState(this.boundSecondary[0])}</span>
      </div>
    `;
  }

  renderInfo() {
    const info = [];
    if (this.config.show.extrema) info.push(this.min);
    if (this.config.show.average) info.push(this.avg);
    if (this.config.show.extrema) info.push(this.max);
    if (!info.length) return;
    return html`
      <div class="info flex">
        ${info.map(entry => html`
          <div class="info__item">
            <span class="info__item__type">${entry.type}</span>
            <span class="info__item__value">
              ${this.computeState(entry.state)} ${this.computeUom(0)}
            </span>
            <span class="info__item__time">
              ${entry.type !== 'avg' ? getTime(new Date(entry.last_changed), this.config.format, this._hass.language) : ''}
            </span>
          </div>
        `)}
      </div>
    `;
  }

  handlePopup(e, entity) {
    e.stopPropagation();
    handleClick(this, this._hass, this.config, this.config.tap_action, entity.entity_id);
  }

  computeThresholds(stops, type) {
    stops.sort((a, b) => b.value - a.value);

    if (type === 'smooth') {
      return stops;
    } else {
      const rect = [].concat(...stops.map((stop, i) => ([stop, {
        value: stop.value - 0.0001,
        color: stops[i + 1] ? stops[i + 1].color : stop.color,
      }])));
      return rect;
    }
  }

  computeColor(inState, i) {
    const { color_thresholds, line_color } = this.config;
    const state = Number(inState) || 0;
    const threshold = {
      color: line_color[i] || line_color[0],
      ...color_thresholds.slice(-1)[0],
      ...color_thresholds.find(ele => ele.value < state),
    };
    return this.config.entities[i].color || threshold.color;
  }

  get visibleEntities() {
    return this.config.entities.filter(entity => entity.show_graph !== false);
  }

  get primaryYaxisEntities() {
    return this.visibleEntities.filter(entity => entity.y_axis === undefined
      || entity.y_axis === 'primary');
  }

  get secondaryYaxisEntities() {
    return this.visibleEntities.filter(entity => entity.y_axis === 'secondary');
  }

  get visibleLegends() {
    return this.visibleEntities.filter(entity => entity.show_legend !== false);
  }

  get primaryYaxisSeries() {
    return this.primaryYaxisEntities.map(entity => this.Graph[entity.index]);
  }

  get secondaryYaxisSeries() {
    return this.secondaryYaxisEntities.map(entity => this.Graph[entity.index]);
  }

  intColor(inState, i) {
    const { color_thresholds, line_color } = this.config;
    const state = Number(inState) || 0;

    let intColor;
    if (color_thresholds.length > 0) {
      if (this.config.show.graph === 'bar') {
        const { color } = color_thresholds.find(ele => ele.value < state)
          || color_thresholds.slice(-1)[0];
        intColor = color;
      } else {
        const index = color_thresholds.findIndex(ele => ele.value < state);
        const c1 = color_thresholds[index];
        const c2 = color_thresholds[index - 1];
        if (c2) {
          const factor = (c2.value - inState) / (c2.value - c1.value);
          intColor = interpolateColor(c2.color, c1.color, factor);
        } else {
          intColor = index
            ? color_thresholds[color_thresholds.length - 1].color
            : color_thresholds[0].color;
        }
      }
    }

    return this.config.entities[i].color || intColor || line_color[i] || line_color[0];
  }

  computeName(index) {
    return this.config.entities[index].name || this.entity[index].attributes.friendly_name;
  }

  computeIcon(entity) {
    return (
      this.config.icon
      || entity.attributes.icon
      || ICONS[entity.attributes.device_class]
      || ICONS.temperature
    );
  }

  computeUom(index) {
    return (
      this.config.entities[index].unit
      || this.config.unit
      || this.entity[index].attributes.unit_of_measurement
      || ''
    );
  }

  computeState(inState) {
    if (this.config.state_map.length > 0) {
      const stateMap = Number.isInteger(inState)
        ? this.config.state_map[inState]
        : this.config.state_map.find(state => state.value === inState);

      if (stateMap) {
        return stateMap.label;
      } else {
        // eslint-disable-next-line no-console
        console.warn(`long-term-card: value [${inState}] not found in state_map`);
      }
    }

    let state;
    if (typeof inState === 'string') {
      state = parseFloat(inState.replace(/,/g, '.'));
    } else {
      state = Number(inState);
    }
    const dec = this.config.decimals;
    if (dec === undefined || Number.isNaN(dec) || Number.isNaN(state))
      return Math.round(state * 100) / 100;

    const x = 10 ** dec;
    return (Math.round(state * x) / x).toFixed(dec);
  }

  updateOnInterval() {
    if (this.stateChanged && !this.updating) {
      this.stateChanged = false;
      this.updateData();
    }
  }

  async updateData({ config } = this) {
    this.updating = true;

    const end = this.getEndDate();
    const start = new Date();
    start.setHours(end.getHours() - config.hours_to_show);

    try {
      const promise = this.entity.map((entity, i) => this.updateEntity(entity, i, start, end));
      await Promise.all(promise);
    } finally {
      this.updating = false;
    }

    this.updateQueue = [];

    this.bound = [
      config.lower_bound !== undefined
        ? config.lower_bound
        : Math.min(...this.primaryYaxisSeries.map(ele => ele.min)) || this.bound[0],
      config.upper_bound !== undefined
        ? config.upper_bound
        : Math.max(...this.primaryYaxisSeries.map(ele => ele.max)) || this.bound[1],
    ];

    this.boundSecondary = [
      config.lower_bound_secondary !== undefined
        ? config.lower_bound_secondary
        : Math.min(...this.secondaryYaxisSeries.map(ele => ele.min)) || this.boundSecondary[0],
      config.upper_bound_secondary !== undefined
        ? config.upper_bound_secondary
        : Math.max(...this.secondaryYaxisSeries.map(ele => ele.max)) || this.boundSecondary[1],
    ];

    if (config.show.graph) {
      this.entity.forEach((entity, i) => {
        if (!entity || this.Graph[i].coords.length === 0) return;
        const bound = config.entities[i].y_axis === 'secondary' ? this.boundSecondary : this.bound;
        [this.Graph[i].min, this.Graph[i].max] = [bound[0], bound[1]];
        if (config.show.graph === 'bar') {
          this.bar[i] = this.Graph[i].getBars(i, this.visibleEntities.length);
        } else {
          const line = this.Graph[i].getPath();
          if (config.entities[i].show_line !== false) this.line[i] = line;
          if (config.show.fill
            && config.entities[i].show_fill !== false) this.fill[i] = this.Graph[i].getFill(line);
          if (config.show.points && (config.entities[i].show_points !== false)) {
            this.points[i] = this.Graph[i].getPoints();
          }
          if (config.color_thresholds.length > 0 && !config.entities[i].color)
            this.gradient[i] = this.Graph[i].computeGradient(config.color_thresholds);
        }
      });
      this.line = [...this.line];
    }
  }


  async updateEntity(entity, index, initStart, end) {
    if (!entity
      || !this.updateQueue.includes(entity.entity_id)
      || this.config.entities[index].show_graph === false
    ) return;
		// this is called when the state changes
		// we're going to rework this to actually grab the atrribute data instead
    let start = initStart;
    let skipInitialState = false;
    let raw_data = entity.attributes.entries; // entries stores the file content
		let i_out=0;
		let last_point = -1;
		// is this really the way to work around parseDate


		// clear exising data
		this.data = [];
    for (var i = 0; i < raw_data.length; i += 1) {
			if(raw_data[i].split(this.config.data_delimiter).length>1){ // skip e.g. blank lines
				if(last_point==-1){
					last_point = i;
					if(this.config.display_mode=='diff'){
						// skip first line, can't diff it againt anything
						continue;
					}
				}
				var eventDate = raw_data[i].split(this.config.data_delimiter)[0];
				var parsedDate = parseDate(eventDate,this.config.formater);
				// check if data within limit
				if((Date.now()-parsedDate)<(this.config.maxDays*86400000)) {
					this.data[i_out] = [];
					this.data[i_out]["last_changed_org"] = eventDate;
					this.data[i_out]["last_changed"] = parsedDate.toString();
					if(this.config.display_mode=='diff'){
						// difference in days between the data, mostly this should be 1.0
						let d_x = (parsedDate-parseDate(raw_data[last_point].split(this.config.data_delimiter)[0],this.config.formater))/86400000;
						let d_y = parseFloat(raw_data[i].split(this.config.data_delimiter)[data_field])-parseFloat(raw_data[last_point].split(this.config.data_delimiter)[data_field])
						// scale to 'per day'
						this.data[i_out]["state"] = d_y/d_x;
						// todo
					} else {
						this.data[i_out]["state"] = parseFloat(raw_data[i].split(this.config.data_delimiter)[data_field]);
					}
					i_out++;
				}
				last_point = i;
			}
    }
		this.setTooltip(0,i_out-1, this.data[i_out-1]["state"]);

    if (entity.entity_id === this.entity[0].entity_id) {
      this.min = {
        type: 'min',
        ...getMin(this.data, 'state'),
      };
      this.avg = {
        type: 'avg',
        state: getAvg(this.data, 'state'),
      };
      this.max = {
        type: 'max',
        ...getMax(this.data, 'state'),
      };
    }

    if (this.config.entities[index].fixed_value === true) {
      const last = this.data[this.data.length - 1];
      this.Graph[index].update([last, last]);
    } else {
      this.Graph[index].update(this.data);
    }
  }

  async fetchRecent(entityId, start, end, skipInitialState) {
    let url = 'history/period';
    if (start) url += `/${start.toISOString()}`;
    url += `?filter_entity_id=${entityId}`;
    if (end) url += `&end_time=${end.toISOString()}`;
    if (skipInitialState) url += '&skip_initial_state';
    return this._hass.callApi('GET', url);
  }


  _convertState(res) {
    const resultIndex = this.config.state_map.findIndex(s => s.value === res.state);
    if (resultIndex === -1) {
      return;
    }

    res.state = resultIndex;
  }

  getEndDate() {
    const date = new Date();
    switch (this.config.group_by) {
      case 'date':
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0);
        break;
      case 'hour':
        date.setHours(date.getHours() + 1);
        date.setMinutes(0, 0);
        break;
      default:
        break;
    }
    return date;
  }

  getCardSize() {
    return 3;
  }
}

customElements.define('long-term-card', MiniGraphCard);
