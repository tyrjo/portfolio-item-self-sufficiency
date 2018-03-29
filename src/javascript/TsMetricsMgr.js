/* global Ext _ Rally TsConstants Deft TsUtils TsSelfSufficiency */
Ext.define('TsMetricsMgr', function() {
    return {
        statics: {
            setMetrics: setMetrics
        }
    }

    function setMetrics(portfolioItem) {
        if (!portfolioItem) {
            return
        }

        var projectOid = Rally.getApp().getContext().getProject().ObjectID;
        var portfolioItemOid = portfolioItem.get('ObjectID');

        return getDescendentProjects(projectOid)
            .then({
                scope: this,
                success: function(projects) {
                    var oids = _.map(projects, function(project) {
                        return project.get('ObjectID');
                    });

                    // Get the filters needed to load the stories in/out of the project hierarchy
                    var piFilter = getPiFilter(portfolioItemOid);
                    var leafStoriesFilter = getLeafStoriesFilter();
                    var insideStoriesFilter = getStoriesFilter(oids, true).and(piFilter).and(leafStoriesFilter);
                    var outsideStoriesFilter = getStoriesFilter(oids, false).and(piFilter).and(leafStoriesFilter);

                    // Load the in/out stories in parallel
                    return Deft.Promise.all([
                        loadStories(insideStoriesFilter),
                        loadStories(outsideStoriesFilter)
                    ]).then({
                        scope: this,
                        success: function(results) {
                            var insideStories = results[0];
                            var outsideStories = results[1];

                            var insideCount = insideStories.length;
                            var insidePoints = _.reduce(insideStories, function(accumulator, story) {
                                return accumulator += story.get('PlanEstimate');
                            }, 0);

                            var outsideCount = outsideStories.length;
                            var outsidePoints = _.reduce(outsideStories, function(accumulator, story) {
                                return accumulator += story.get('PlanEstimate');
                            }, 0);

                            var metrics = Ext.create('TsSelfSufficiency', {
                                TotalStoryCount: insideCount + outsideCount,
                                TotalPoints: insidePoints + outsidePoints,
                                InsideStoryCount: insideCount,
                                InsideStoryPoints: insidePoints,
                                OutsideStoryCount: outsideCount,
                                OutsideStoryPoints: outsidePoints,
                                InsideStoriesFilter: insideStoriesFilter, // Needed so we can use these same filters to display details
                                OutsideStoriesFilter: outsideStoriesFilter // Needed so we can use these same filters to display details
                            });

                            // Add the Self Sufficiency fields to the portfolio item directly so they can be used in a grid of PIs
                            TsUtils.updateRecord(portfolioItem, metrics);
                        }
                    })
                }
            });
    }

    function getDescendentProjects(projectOid) {
        var queries = _.forEach(TsUtils.getParentQueries(), function(query) {
            query.property += ".ObjectID";
            query.value = projectOid;
        });
        // Include the parent project itself
        queries.push({
            property: "ObjectID",
            value: projectOid
        })
        var store = Ext.create('Rally.data.wsapi.Store', {
            model: 'Project',
            fetch: TsConstants.FETCH.PROJECT,
            autoLoad: false,
            filters: Rally.data.wsapi.Filter.or(queries),
        });

        return store.load();
    }

    /**
     * @param projectOids leaf stories under one of these projects
     * @param inProjects (boolean) true for stories in one of the projects, false for stories NOT in one of the projects
     */
    function getStoriesFilter(projectOids, inProjects) {
        var result;
        var projectOidsQueries = _.map(projectOids, function(oid) {
            return {
                property: 'Project.ObjectID',
                operator: inProjects ? '=' : '!=',
                value: oid
            }
        });
        if (inProjects) {
            result = Rally.data.wsapi.Filter.or(projectOidsQueries);
        }
        else {
            result = Rally.data.wsapi.Filter.and(projectOidsQueries);
        }
        return result;
    }

    function getPiFilter(portfolioItemOid) {
        // TODO (tj) make this query dynamic based on defined PortfolioItemTypes
        var parentQueries = [{
                property: 'Feature.ObjectID', // Feature
                value: portfolioItemOid
            },
            {
                property: 'Feature.Parent.ObjectID', // Epic
                value: portfolioItemOid
            },
            {
                property: 'Feature.Parent.Parent.ObjectID', // Initiative
                value: portfolioItemOid
            },
            {
                property: 'Feature.Parent.Parent.Parent.ObjectID', // Theme
                value: portfolioItemOid
            },
            {
                property: 'Feature.Parent.Parent.Parent.Parent.ObjectID', // Group
                value: portfolioItemOid
            }
        ];
        return Rally.data.wsapi.Filter.or(parentQueries);
    }

    function getLeafStoriesFilter() {
        return new Rally.data.wsapi.Filter({
            property: 'DirectChildrenCount',
            value: 0
        });
    }

    function loadStories(filters) {
        return Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            model: 'HierarchicalRequirement',
            context: {
                project: null
            },
            fetch: TsConstants.FETCH.USER_STORY,
            autoLoad: false,
            enableHierarchy: false,
            filters: filters,
            enableRootLevelPostGet: true,
        }).then(function(store) {
            return loadAllData(store);
        });
    }

    /**
     * Given a tree store, load ALL of the data into an array and return the array.
     * By default, the tree store will only load the current page at a time.
     * 
     * @returns A promise that resolves with all the data (instead of just a page worth)
     */
    function loadAllData(store, accumulator) {
        if (!accumulator) {
            accumulator = [];
        }

        return store.load().then(function(results) {
            accumulator = accumulator.concat(results);
            var totalCount = store.getTotalCount();
            var loadedCount = accumulator.length;
            if (loadedCount < totalCount) {
                store._setCurrentPage(store.currentPage + 1);
                return loadAllData(store, accumulator);
            }
            else {
                store._setCurrentPage(1);
                return accumulator;
            }
        });
    }
});
