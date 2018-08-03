import extend                 from 'extend';
import {
    action,
    computed,
    observable }              from 'mobx';
import { ChartBarrierStore }  from './chart_barrier_store';
import { ChartMarkerStore }   from './chart_marker_store';
import {
    barriersObjectToArray,
    isBarrierSupported }      from './Helpers/barriers';
import BaseStore              from '../../base_store';
import { WS }                 from '../../../Services';
import { isEmptyObject }      from '../../../../_common/utility';

export default class SmartChartStore extends BaseStore {
    @observable symbol;
    @observable barriers = observable.object({});
    @observable markers  = observable.object({});

    is_contract_mode = false;

    @action.bound
    onUnmount = () => {
        this.symbol = null;
        this.removeBarriers();
        this.removeMarkers();
    };

    // ---------- Barriers ----------
    @action.bound
    createBarriers = (contract_type, high_barrier, low_barrier, onChartBarrierChange, config) => {
        if (isEmptyObject(this.barriers.main)) {
            let main_barrier = {};
            if (isBarrierSupported(contract_type)) {
                main_barrier = new ChartBarrierStore(high_barrier, low_barrier, onChartBarrierChange, config);
            }

            this.barriers = {
                main: main_barrier,
            };
        }
    };

    @action.bound
    updateBarriers(barrier_1, barrier_2) {
        if (!isEmptyObject(this.barriers.main)) {
            this.barriers.main.updateBarriers(barrier_1, barrier_2);
        }
    }

    @action.bound
    updateBarrierShade(should_display, contract_type) {
        if (!isEmptyObject(this.barriers.main)) {
            this.barriers.main.updateBarrierShade(should_display, contract_type);
        }
    }

    @action.bound
    removeBarriers() {
        this.barriers = {};
    }

    @computed
    get barriers_array() {
        return barriersObjectToArray(this.barriers);
    }

    // ---------- Markers ----------
    @action.bound
    createMarker(config) {
        this.markers = extend({}, this.markers, {
            [config.type]: new ChartMarkerStore(config.marker_config, config.content_config),
        });
    }

    @action.bound
    removeMarkers() {
        this.markers = {};
    }

    @computed
    get markers_array() {
        return barriersObjectToArray(this.markers);
    }

    // ---------- Chart Settings ----------
    @computed
    get settings() { // TODO: consider moving chart settings from ui_store to chart_store
        return (({ common, ui } = this.root_store) => ({
            assetInformation: ui.is_chart_asset_info_visible,
            countdown       : ui.is_chart_countdown_visible,
            lang            : common.current_language,
            position        : ui.is_chart_layout_default ? 'bottom' : 'left',
            theme           : ui.is_dark_mode_on ? 'dark' : 'light',
        }))();
    }

    // ---------- WS ----------
    wsSubscribe = (request_object, callback) => {
        if (request_object.subscribe !== 1) return;
        WS.subscribeTicksHistory(request_object, callback);
    };

    wsForget = (match_values, callback) => (
        WS.forget('ticks_history', callback, match_values)
    );

    wsSendRequest = (request_object) => (
        WS.sendRequest(request_object)
    );
};
