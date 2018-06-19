/* global Ext TsConstants TsMetricsMgr _ */
Ext.define("CArABU.app.TSApp", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    layout: 'border',
    items: [{
            xtype: 'panel',
            itemId: TsConstants.ID.SELECTION_AREA,
            padding: '0 0 10 0',
            autoScroll: true,
            bodyPadding: 5,
            split: true,
            width: "50%",
            region: 'west'
        },
        {
            xtype: 'tabpanel',
            itemId: TsConstants.ID.RESULTS_AREA,
            items: [{
                xtype: 'panel',
                itemId: TsConstants.ID.SUMMARY_PANEL,
                title: TsConstants.LABEL.SUMMARY_PANEL,
                autoScroll: true,
                layout: 'vbox',
                items: [{
                    xtype: 'panel',
                    itemId: 'selectLabel',
                    padding: '20 20 20 20',
                    width: 200,
                    border: false,
                    html: 'Select an item on the left...'
                }],
            }, {
                xtype: 'panel',
                itemId: TsConstants.ID.DETAILS_PANEL,
                title: TsConstants.LABEL.DETAILS_PANEL,
                layout: {
                    type: 'vbox',
                    align: 'stretch'
                },
                autoScroll: true,
                items: [{
                    xtype: 'panel',
                    itemId: 'selectLabel',
                    padding: '20 20 20 20',
                    width: 200,
                    border: false,
                    html: 'Select an item on the left...'
                }]
            }],
            region: 'center',
        },
    ],

    config: {
        defaultSettings: {
            WARNING_THRESHOLD: 80
        }
    },

    launch: function() {
        this.getPiTypes();
    },

    getPiTypes: function() {
        Rally.data.util.PortfolioItemHelper.getPortfolioItemTypes().then({
            scope: this,
            success: function(records) {
                this.piTypeDefs = records;
                this.addPiTypeSelector();
            }
        })
    },

    addPiTypeSelector: function() {
        var navPanel = this.down('#' + TsConstants.ID.SELECTION_AREA);
        navPanel.add({
            xtype: 'rallyportfolioitemtypecombobox',
            fieldLabel: TsConstants.LABEL.PI_TYPE,
            labelWidth: 150,
            listeners: {
                scope: this,
                change: function(combobox, newValue) {
                    if (newValue) {
                        this.addItemSelector(combobox.getSelectedType());
                    }
                }
            }
        });
    },

    addItemSelector: function(piType) {
        if (piType) {
            // Get all leaf user stories that belong to this project or its descendents
            var piOids = [];
            var lowestPiName = this.piTypeDefs[0].get('Name');
            var store = Ext.create('Rally.data.wsapi.Store', {
                model: 'User Story',
                autoLoad: false,
                limit: Infinity,
                context: {
                    projectScopeUp: false,
                    projectScopeDown: true,
                },
                filters: [{
                    property: 'DirectChildrenCount',
                    value: 0
                }],
                fetch: [lowestPiName, 'ObjectID', 'Parent'],
            });
            store.load().then({
                scope: this,
                success: function(records) {
                    var parentPiTypeName = this.piTypeDefs[0].get('Name');
                    if (parentPiTypeName == piType.get('Name')) {
                        // Level 0, aka 'Feature'
                        piOids = this.getOids(parentPiTypeName, records, false);
                        this.loadPortfolioItems(piType, piOids);
                    }
                    else {
                        var grandParentPiTypeName = this.piTypeDefs[1].get('Name');
                        piOids = this.getOids(parentPiTypeName, records, true);
                        if (grandParentPiTypeName == piType.get('Name')) {
                            this.loadPortfolioItems(piType, piOids);
                        }
                        else {
                            // Need next level above
                            this.getPis(1, piType, piOids);
                        }
                    }
                }
            })
        }
    },

    getPis: function(currentPiTypeIndex, selectedPiType, piOids) {
        // Load the next level up Portfolio Items
        var currentPiTypeName = this.piTypeDefs[currentPiTypeIndex].get('TypePath');
        var store = Ext.create('Rally.data.wsapi.Store', {
            model: currentPiTypeName,
            autoLoad: false,
            limit: Infinity,
            fetch: ['ObjectID', 'Parent'],
            context: {
                projectScopeUp: true,
                projectScopeDown: true
            },
            enablePostGet: true,
            filters: this.getOidsFilter(piOids)
        });
        store.load().then({
            scope: this,
            success: function(records) {
                var parentPiTypeName = this.piTypeDefs[currentPiTypeIndex + 1].get('Name');
                piOids = this.getOids('Parent', records, false);
                if (parentPiTypeName == selectedPiType.get('Name')) {
                    this.loadPortfolioItems(selectedPiType, piOids);
                }
                else {
                    // Need next level above
                    this.getPis(currentPiTypeIndex + 1, selectedPiType, piOids);
                }
            }
        });
    },

    getOids: function(piTypeName, stories, getParent) {
        var oids = [];
        _.forEach(stories, function(story) {
            try {
                var pi = story.get(piTypeName);
                if (getParent) {
                    oids.push(story.get(piTypeName).Parent.ObjectID);
                }
                else {
                    oids.push(story.get(piTypeName).ObjectID);
                }
            }
            catch (ex) {
                //Ignore stories without Features
            }
        });
        return _.uniq(oids);
    },

    getOidsFilter: function(oids) {
        var queries = _.map(oids, function(oid) {
            return {
                property: 'ObjectID',
                value: oid
            }
        });
        return Rally.data.wsapi.Filter.or(queries);
    },

    loadPortfolioItems: function(piType, piOids) {
        var filter = this.getOidsFilter(piOids);
        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            models: [piType.get('TypePath')],
            context: {
                projectScopeUp: true,
                projectScopeDown: true,
            },
            filters: filter,
            enableRootLevelPostGet: true,
            fetch: TsConstants.FETCH.PI,
            autoLoad: true,
            enableHierarchy: true
        }).then({
            scope: this,
            success: function(store) {
                var navPanel = this.down('#' + TsConstants.ID.SELECTION_AREA);
                if (this.itemSelector) {
                    navPanel.remove(this.itemSelector);
                }
                this.itemSelector = navPanel.add({
                    items: [{
                        xtype: 'rallytreegrid',
                        columnCfgs: [
                            'Name',
                            'Project',
                            {
                                text: 'Self-Sufficiency By Story Count',
                                dataIndex: 'ObjectID',
                                sortable: false,
                                scope: this,
                                renderer: function(value, meta, record) {
                                    var part = record.get('InsideStoryCount');
                                    var whole = record.get('TotalStoryCount');
                                    return this.percentRenderer(part, whole);
                                }
                            },
                            {
                                text: 'Self-Sufficiency By Story Points',
                                dataIndex: 'ObjectID',
                                sortable: false,
                                scope: this,
                                renderer: function(value, meta, record) {
                                    var part = record.get('InsideStoryPoints');
                                    var whole = record.get('TotalPoints');
                                    return this.percentRenderer(part, whole);
                                }
                            }
                        ],
                        enableBulkEdit: false,
                        enableColumnHide: true,
                        enableColumnMove: true,
                        enableColumnResize: true,
                        enableEditing: false,
                        enableInlineAdd: false,
                        enableRanking: false,
                        shouldShowRowActionsColumn: true,
                        store: store,
                        fetch: ['ObjectID'],
                        listeners: {
                            scope: this,
                            load: function(store, node, records) {
                                _.forEach(records, function(record) {
                                    TsMetricsMgr.setMetrics(record);
                                })
                            },
                            itemclick: function(tree, record) {
                                // Only draw the charts if data has loaded for the item
                                if (record.get('TotalStoryCount')) {
                                    this.addCharts(record);
                                    this.addDetails(record);
                                }
                            }
                        }
                    }],
                });
            }
        });
    },

    addCharts: function(record) {
        var summaryPanel = this.down('#' + TsConstants.ID.SUMMARY_PANEL);
        summaryPanel.removeAll();

        var insideProject = record.get('InsideStoryCount');
        var total = record.get('TotalStoryCount');
        summaryPanel.add(this.getChart(insideProject, total, TsConstants.LABEL.BY_COUNT));

        insideProject = record.get('InsideStoryPoints');
        total = record.get('TotalPoints');
        summaryPanel.add(this.getChart(insideProject, total, TsConstants.LABEL.BY_POINTS));
    },

    addDetails: function(record) {
        var detailsPanel = this.down('#' + TsConstants.ID.DETAILS_PANEL);
        detailsPanel.removeAll();

        var appHeight = this.getHeight();
        // Workaround because rallytreegrid has zero height without explicit height setting
        var gridHeight = (appHeight - 80) / 2;

        // For some reason, the rallygridboard is really unhappy if the same PI
        // is clicked again, it blanks all the rows. The workaround is to recreate
        // the store AND the grid each time an item is clicked. For this reason, the
        // filters used to load the in/out stories are saved for each PI and used here.
        // The alternative of re-using the stores that were created in the TsMetricsMgr
        // didn't work, and would blank all stories when a PI was clicked a second time.

        // Add the grid of outside stories
        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            model: 'HierarchicalRequirement',
            context: {
                project: null
            },
            fetch: TsConstants.FETCH.USER_STORY,
            autoLoad: true,
            enableHierarchy: false,
            filters: record.get('OutsideStoriesFilter')
        }).then({
            scope: this,
            success: function(store) {
                detailsPanel.add({
                    xtype: 'panel',
                    collapsible: true,
                    layout: {
                        type: 'vbox',
                        align: 'stretch',
                        padding: '0 5 5 5',
                    },
                    title: TsConstants.LABEL.OUTSIDE_PROJECT + ' (' + record.get('OutsideStoryCount') + ')',
                    items: [{
                        xtype: 'rallygridboard',
                        height: gridHeight,
                        stateful: true,
                        stateId: TsConstants.ID.OUTSIDE_STORY_GRID,
                        gridConfig: {
                            store: store,
                            columnCfgs: TsConstants.SETTING.DEFAULT_DETAILS_FIELDS,
                            enableRanking: false,
                        },
                        plugins: [{
                            ptype: 'rallygridboardfieldpicker',
                            headerPosition: 'left',
                            modelNames: ['HierarchicalRequirement'],
                        }, ],
                        listeners: {
                            boxready: function(grid) {
                                grid.setLoading(true);
                            },
                            load: function(grid) {
                                grid.setLoading(false);
                            }
                        }
                    }]
                });
            }
        });

        // Add the grid of inside stories
        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            model: 'HierarchicalRequirement',
            context: {
                project: null
            },
            fetch: TsConstants.FETCH.USER_STORY,
            autoLoad: true,
            enableHierarchy: false,
            filters: record.get('InsideStoriesFilter')
        }).then({
            scope: this,
            success: function(store) {
                detailsPanel.add({
                    xtype: 'panel',
                    collapsible: true,
                    layout: {
                        type: 'vbox',
                        align: 'stretch',
                        padding: '0 5 5 5',
                    },
                    title: TsConstants.LABEL.INSIDE_PROJECT + ' (' + record.get('InsideStoryCount') + ')',
                    items: [{
                        xtype: 'rallygridboard',
                        height: gridHeight,
                        stateful: true,
                        stateId: TsConstants.ID.INSIDE_STORY_GRID,
                        gridConfig: {
                            store: store,
                            columnCfgs: TsConstants.SETTING.DEFAULT_DETAILS_FIELDS,
                            enableRanking: false
                        },
                        plugins: [{
                            ptype: 'rallygridboardfieldpicker',
                            headerPosition: 'left',
                            modelNames: ['HierarchicalRequirement'],
                        }],
                        listeners: {
                            boxready: function(grid) {
                                grid.setLoading(true);
                            },
                            load: function(grid) {
                                grid.setLoading(false);
                            }
                        }
                    }]
                });
            }
        });
    },

    getChart: function(inside, total, title) {
        // Set a warning color if the percent inside the project is less than the warning threshold
        var setWarning = (inside / total) * 100 < this.getSetting(TsConstants.SETTING.WARNING_THRESHOLD) ? true : false;
        var pointFormatter = function() {
            return this.point.y + ' ' + this.point.name + '<br/><b>( ' + Math.round(this.point.percentage) + '% )</b>';
        };
        var self = this;
        return {
            xtype: 'rallychart',
            loadMask: false,
            chartData: {
                series: [{
                    name: TsConstants.LABEL.PROJECT_SELF_SUFFICIENCY,
                    //colors: TsConstants.CHART.COLORS,
                    borderColor: '#000000',
                    dataLabels: {
                        formatter: pointFormatter,
                        //distance: -30,
                        style: {
                            width: '150px'
                        }
                    },
                    data: [{
                        name: TsConstants.LABEL.INSIDE_PROJECT,
                        color: TsConstants.CHART.OK,
                        y: inside,
                    }, {
                        name: TsConstants.LABEL.OUTSIDE_PROJECT,
                        color: setWarning ? TsConstants.CHART.WARNING : TsConstants.CHART.NORMAL_1,
                        y: total - inside
                    }],
                    tooltip: {
                        followPointer: false,
                        pointFormat: 'Click for details'
                    },
                    point: {
                        events: {
                            click: self.onChartClick.bind(self)
                        }
                    },
                    enableMouseTracking: true
                }]
            },
            chartConfig: {
                chart: {
                    type: 'pie',
                    height: "400",
                },
                plotOptions: {
                    pie: {
                        size: '75%',
                    }
                },
                subtitle: {
                    text: TsConstants.LABEL.PROJECT_SELF_SUFFICIENCY
                },
                title: {
                    text: title
                }
            }
        }
    },

    onChartClick: function() {
        // Switch to details view
        this.down('#' + TsConstants.ID.RESULTS_AREA).setActiveTab(TsConstants.ID.DETAILS_PANEL);
    },

    percentRenderer: function(part, whole) {
        var result;
        if (part == undefined || whole == undefined) {
            // The metric hasn't been computed
            result = 'Loading...';
        }
        else {
            result = Math.round(part / whole * 100);
            if (isNaN(result) || !isFinite(result)) {
                result = '--';
            }
            else {
                var warningThreshold = this.getSetting(TsConstants.SETTING.WARNING_THRESHOLD);
                var classes = '';
                if (result == 0) {
                    classes = 'unowned';
                }
                else if (result < warningThreshold) {
                    classes = 'caution'
                }
                result = '<div class="' + classes + '">' + result + '%</div>';
            }
        }
        return result;
    },

    getSettingsFields: function() {
        return [{
            xtype: 'rallynumberfield',
            name: TsConstants.SETTING.WARNING_THRESHOLD,
            label: TsConstants.LABEL.WARNING_THRESHOLD,
            labelWidth: 200,
            maxValue: 100,
            minValue: 0,
            allowDecimals: false
        }];
    },

    getOptions: function() {
        var options = [{
            text: 'About...',
            handler: this._launchInfo,
            scope: this
        }];

        return options;
    },

    _launchInfo: function() {
        if (this.about_dialog) { this.about_dialog.destroy(); }

        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink', {
            showLog: this.getSetting('saveLog'),
            logger: this.logger
        });
    },

    isExternal: function() {
        return typeof(this.getAppId()) == 'undefined';
    }

});
