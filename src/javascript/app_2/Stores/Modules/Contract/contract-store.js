import {
    action,
    computed,
    extendObservable,
    observable }                  from 'mobx';
import { isEmptyObject }          from '_common/utility';
import { localize }               from '_common/localize';
import { WS }                     from 'Services';
import { createChartBarrier }     from './Helpers/chart-barriers';
import { createChartMarkers }     from './Helpers/chart-markers';
import {
    createChartTickMarkers,
    destroyChartTickMarkers }    from './Helpers/chart-tick-markers';
import {
    getDetailsExpiry,
    getDetailsInfo }             from './Helpers/details';
import {
    getDigitInfo,
    isDigitContract }            from './Helpers/digits';
import {
    calculateGranularity,
    getChartConfig,
    getDisplayStatus,
    getEndSpot,
    getEndSpotTime,
    getFinalPrice,
    getIndicativePrice,
    isEnded,
    isSoldBeforeStart,
    isStarted,
    isUserSold,
    isValidToSell }              from './Helpers/logic';
import BaseStore                 from '../../base-store';

export default class ContractStore extends BaseStore {
    @observable contract_id;
    @observable contract_info = observable.object({});
    @observable digits_info   = observable.object({});
    @observable sell_info     = observable.object({});
    @observable chart_config  = observable.object({});

    @observable has_error         = false;
    @observable error_message     = '';
    @observable is_sell_requested = false;
    @observable contract_symbol;
    @observable trade_symbol;
    @observable is_left_epoch_set = false;

    // -------------------
    // ----- Actions -----
    // -------------------
    @action.bound
    updateChartType(chart_type) {
        this.chart_config.chart_type = chart_type;
    }

    @action.bound
    updateGranularity(granularity) {
        this.chart_config.granularity = granularity;
    }

    @action.bound
    drawChart(SmartChartStore, contract_info) {
        if (contract_info.tick_count) {
            SmartChartStore.updateGranularity(0);
            SmartChartStore.updateChartType('mountain');
        } else {
            const granularity = calculateGranularity(contract_info.date_expiry - contract_info.date_start);
            SmartChartStore.updateGranularity(granularity);
        }
        if (isEnded(contract_info)) {
            this.chart_config = getChartConfig(contract_info);
        } else {
            if (!this.is_left_epoch_set && contract_info.tick_count) {
                SmartChartStore.updateEpochScrollToValue(contract_info.purchase_time || contract_info.date_start);
            }
            delete this.chart_config.end_epoch;
            delete this.chart_config.start_epoch;
            this.is_left_epoch_set = true;
        }

        createChartBarrier(SmartChartStore, contract_info);

        if (contract_info.tick_count && contract_info.exit_tick_time) { // TODO: remove this.contract_info.exit_tick_time when ongoing contracts are implemented
            createChartTickMarkers(SmartChartStore, contract_info);
        } else {
            createChartMarkers(SmartChartStore, contract_info);
        }

        this.handleDigits();
    }

    @action.bound
    onMount(contract_id) {
        this.onSwitchAccount(this.accountSwitcherListener.bind(null));
        this.has_error     = false;
        this.error_message = '';
        this.contract_id   = contract_id;
        this.smart_chart   = this.root_store.modules.smart_chart;

        if (contract_id) {
            this.smart_chart.updateEpochScrollToOffset(1);
            this.smart_chart.updateChartZoom(100);
            this.smart_chart.setContractMode(true);
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 2000);
            WS.subscribeProposalOpenContract(this.contract_id, this.updateProposal, false);
        }
    }

    @action.bound
    onLoadContract(contract_info) {
        if (+contract_info.contract_id === this.contract_id || !contract_info) return;
        this.onSwitchAccount(this.accountSwitcherListener.bind(null));
        this.smart_chart   = this.root_store.modules.smart_chart;
        this.contract_info = contract_info;
        this.contract_id   = +contract_info.contract_id;
        this.smart_chart.setContractMode(true);
        this.smart_chart.updateEpochScrollToOffset(1);
        this.smart_chart.updateChartZoom(100);
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 2000);
        this.drawChart(this.smart_chart, this.contract_info);
    }

    @action.bound
    accountSwitcherListener () {
        this.smart_chart.setContractMode(false);
        return new Promise((resolve) => resolve(this.onCloseContract()));
    }

    @action.bound
    onCloseContract() {
        this.forgetProposalOpenContract();
        this.contract_id       = null;
        this.contract_info     = {};
        this.digits_info       = {};
        this.sell_info         = {};
        this.is_sell_requested = false;
        this.chart_config      = {};
        this.is_left_epoch_set = false;

        destroyChartTickMarkers();
        this.smart_chart.removeBarriers();
        this.smart_chart.removeMarkers();
        this.smart_chart.resetScrollZoom();
        this.smart_chart.updateGranularity(0);
        this.smart_chart.setContractMode(false);
    }

    @action.bound
    onUnmount() {
        this.disposeSwitchAccount();
        this.onCloseContract();
    }

    @action.bound
    updateProposal(response) {
        if ('error' in response) {
            this.has_error     = true;
            this.error_message = response.error.message;
            this.contract_info = {};
            return;
        }
        if (isEmptyObject(response.proposal_open_contract)) {
            this.has_error     = true;
            this.error_message = localize('Contract does not exist or does not belong to this client.');
            this.contract_info = {};
            this.contract_id   = null;
            this.smart_chart.setContractMode(false);
            return;
        }
        this.contract_info = response.proposal_open_contract;
        this.drawChart(this.smart_chart, this.contract_info);

    }

    @action.bound
    handleDigits() {
        if (isDigitContract(this.contract_info.contract_type)) {
            extendObservable(this.digits_info, getDigitInfo(this.digits_info, this.contract_info));
        }
    }

    @action.bound
    onClickSell() {
        if (this.contract_id && !this.is_sell_requested && isEmptyObject(this.sell_info)) {
            this.is_sell_requested = true;
            WS.sell(this.contract_id, this.contract_info.bid_price).then(this.handleSell);
        }
    }

    @action.bound
    handleSell(response) {
        if (response.error) {
            this.sell_info = {
                error_message: response.error.message,
            };

            this.is_sell_requested = false;
        } else {
            this.forgetProposalOpenContract();
            WS.proposalOpenContract(this.contract_id).then(action((proposal_response) => {
                this.updateProposal(proposal_response);
                this.sell_info = {
                    sell_price    : response.sell.sold_for,
                    transaction_id: response.sell.transaction_id,
                };
            }));
        }
    }

    forgetProposalOpenContract() {
        WS.forget('proposal_open_contract', this.updateProposal, { contract_id: this.contract_id });
    }

    @action.bound
    removeSellError() {
        delete this.sell_info.error_message;
    }

    // ---------------------------
    // ----- Computed values -----
    // ---------------------------
    // TODO: currently this runs on each response, even if contract_info is deep equal previous one

    @computed
    get details_expiry() {
        return getDetailsExpiry(this);
    }

    @computed
    get details_info() {
        return getDetailsInfo(this.contract_info);
    }

    @computed
    get display_status() {
        return getDisplayStatus(this.contract_info);
    }

    @computed
    get end_spot() {
        return getEndSpot(this.contract_info);
    }

    @computed
    get end_spot_time() {
        return getEndSpotTime(this.contract_info);
    }

    @computed
    get final_price() {
        return getFinalPrice(this.contract_info);
    }

    @computed
    get indicative_price() {
        return getIndicativePrice(this.contract_info);
    }

    @computed
    get is_ended() {
        return isEnded(this.contract_info);
    }

    @computed
    get is_sold_before_start() {
        return isSoldBeforeStart(this.contract_info);
    }

    @computed
    get is_started() {
        return isStarted(this.contract_info);
    }

    @computed
    get is_user_sold() {
        return isUserSold(this.contract_info);
    }

    @computed
    get is_valid_to_sell() {
        return isValidToSell(this.contract_info);
    }
}
