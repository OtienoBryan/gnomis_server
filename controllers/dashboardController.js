const db = require('../database/db');

/**
 * Optimized Sales Dashboard Data Endpoint
 * Consolidates multiple API calls into a single optimized query
 */
exports.getSalesDashboardData = async (req, res) => {
  try {
    console.log('[getSalesDashboardData] Starting optimized dashboard data fetch...');
    const startTime = Date.now();

    // Get current month date range
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    // Execute all queries in parallel for better performance
    const [
      salesRepsResult,
      teamLeadersResult,
      ordersResult,
      leavesResult,
      managersResult,
      targetsResult,
      planogramComplianceResult,
      checkedInRepsResult,
      checkedInTeamLeadersResult,
      currentMonthOutletsVisitedResult,
      topProductsSoldResult
    ] = await Promise.allSettled([
      // 1. Get all sales reps with route and region info
      db.query(`
        SELECT sr.id, sr.name, sr.status, sr.route_id_update, r.name as route_name, 
               r.region as region_name
        FROM \`SalesRep\` sr
        LEFT JOIN \`routes\` r ON sr.route_id_update = r.id
        WHERE sr.status = 1 AND LOWER(TRIM(sr.role)) = 'sales rep'
        ORDER BY sr.name
      `),

      // 2. Get all active team leaders
      db.query(`
        SELECT sr.id
        FROM \`SalesRep\` sr
        WHERE sr.status = 1 AND LOWER(TRIM(sr.role)) = 'team leader'
      `),

      // 3. Get all orders with necessary data
      db.query(`
        SELECT 
          so.id,
          so.order_date,
          so.total_amount,
          so.my_status,
          so.client_id,
          c.client_type,
          c.route_id_update
        FROM sales_orders so
        LEFT JOIN Clients c ON so.client_id = c.id
        WHERE so.order_date IS NOT NULL
        ORDER BY so.order_date DESC
      `),

      // 4. Get pending leaves count only
      db.query(`
        SELECT COUNT(*) as pending_count
        FROM leaves
        WHERE status = '0' OR status = 0
      `),

      // 5. Get managers
      db.query(`
        SELECT id, name, email, phoneNumber, country, region, managerTypeId
        FROM managers
        ORDER BY name
      `),

      // 6. Get all targets data
      Promise.all([
        db.query('SELECT sales_rep_id, vapes_target, pouches_target FROM distributors_targets'),
        db.query('SELECT sales_rep_id, vapes_target, pouches_target FROM key_account_targets'),
        db.query('SELECT sales_rep_id, vapes_target, pouches_target FROM retail_targets')
      ]),

      // 7. Get planogram compliance data aggregated by month
      db.query(`
        SELECT 
          DATE_FORMAT(pr.createdAt, '%Y-%m') as month_key,
          DATE_FORMAT(pr.createdAt, '%b %Y') as month,
          COALESCE(SUM(pc.compliance_quantity), 0) as total_target,
          COALESCE(SUM(pr.quantity), 0) as total_actual,
          CASE 
            WHEN COALESCE(SUM(pc.compliance_quantity), 0) > 0 
            THEN ROUND((COALESCE(SUM(pr.quantity), 0) / SUM(pc.compliance_quantity)) * 100, 1)
            ELSE 0 
          END as compliance_percentage
        FROM planogram_compliance pc
        LEFT JOIN outlet_accounts oa ON pc.outlet_account_id = oa.id
        LEFT JOIN Clients c ON c.outlet_account = pc.outlet_account_id
        LEFT JOIN ProductReport pr ON pr.clientId = c.id AND pr.productId = pc.product_id
        WHERE pr.createdAt IS NOT NULL
        GROUP BY DATE_FORMAT(pr.createdAt, '%Y-%m'), DATE_FORMAT(pr.createdAt, '%b %Y')
        HAVING total_target > 0
        ORDER BY month_key DESC
        LIMIT 12
      `),

      // 8. Get count of sales reps who have checked in today
      db.query(`
        SELECT COUNT(DISTINCT jp.userId) as checked_in_count
        FROM \`JourneyPlan\` jp
        INNER JOIN \`SalesRep\` sr ON jp.userId = sr.id
        WHERE sr.status = 1
          AND LOWER(TRIM(sr.role)) = 'sales rep'
          AND jp.checkInTime IS NOT NULL
          AND DATE(jp.checkInTime) = CURDATE()
      `),

      // 9. Get count of team leaders who have checked in today
      db.query(`
        SELECT COUNT(DISTINCT sr.id) as checked_in_team_leaders
        FROM JourneyPlan jp
        INNER JOIN SalesRep sr ON jp.userId = sr.id
        WHERE sr.status = 1
          AND LOWER(TRIM(sr.role)) = 'team leader'
          AND jp.checkInTime IS NOT NULL
          AND DATE(jp.checkInTime) = CURDATE()
      `),

      // 10. Get unique outlets visited in the current month
      db.query(`
        SELECT COUNT(DISTINCT jp.clientId) as outlets_visited_count
        FROM JourneyPlan jp
        WHERE jp.status IN (1, 2)
          AND jp.clientId IS NOT NULL
          AND jp.checkInTime IS NOT NULL
          AND DATE(jp.checkInTime) BETWEEN ? AND ?
      `, [currentMonthStart, currentMonthEnd]),

      // 11. Get top 10 products sold this month, by quantity
      db.query(`
        SELECT
          p.id,
          p.product_name,
          p.product_code,
          COALESCE(SUM(soi.quantity), 0) as total_quantity,
          COALESCE(SUM(soi.quantity * soi.unit_price), 0) as total_amount
        FROM products p
        INNER JOIN sales_order_items soi ON soi.product_id = p.id
        INNER JOIN sales_orders so ON soi.sales_order_id = so.id
        WHERE so.my_status = 1 AND so.order_date BETWEEN ? AND ?
        GROUP BY p.id, p.product_name, p.product_code
        HAVING total_quantity > 0
        ORDER BY total_quantity DESC
        LIMIT 10
      `, [currentMonthStart, currentMonthEnd])
    ]);

    // Initialize response data
    const dashboardData = {
      stats: {
        totalSales: 0,
        outletsVisitedThisMonth: 0,
        totalOrders: 0,
        activeReps: 0,
        checkedInReps: 0,
        totalActiveReps: 0,
        activeTeamLeaders: 0,
        checkedInTeamLeaders: 0,
        avgPerformance: 0
      },
      monthlyData: [],
      topReps: [],
      managers: [],
      pendingLeavesCount: 0,
      newOrdersCount: 0,
      pieChartData: [],
      planogramComplianceData: [],
      topProductsSold: []
    };

    // Process sales reps
    let salesReps = [];
    if (salesRepsResult.status === 'fulfilled') {
      salesReps = salesRepsResult.value[0] || [];
      
      // Count ALL sales reps (not filtered by status) for the "all sales reps" display
      dashboardData.stats.totalActiveReps = salesReps.length;
      
      console.log('[getSalesDashboardData] Sales reps query result structure:', {
        hasValue: !!salesRepsResult.value,
        valueType: typeof salesRepsResult.value,
        isArray: Array.isArray(salesRepsResult.value),
        valueLength: salesRepsResult.value ? salesRepsResult.value.length : 0,
        firstElementType: salesRepsResult.value && salesRepsResult.value[0] ? typeof salesRepsResult.value[0] : 'N/A',
        firstElementIsArray: salesRepsResult.value && salesRepsResult.value[0] ? Array.isArray(salesRepsResult.value[0]) : false
      });
      console.log('[getSalesDashboardData] Total sales reps fetched:', salesReps.length);
      console.log('[getSalesDashboardData] Total sales reps (all):', dashboardData.stats.totalActiveReps);
      
      if (salesReps.length > 0) {
        const statusCounts = {};
        salesReps.forEach(rep => {
          const status = String(rep.status || 'null');
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        console.log('[getSalesDashboardData] Status breakdown:', statusCounts);
        console.log('[getSalesDashboardData] First rep sample:', {
          id: salesReps[0].id,
          name: salesReps[0].name,
          status: salesReps[0].status,
          statusType: typeof salesReps[0].status
        });
      } else {
        console.warn('[getSalesDashboardData] No sales reps found in result. Raw value:', JSON.stringify(salesRepsResult.value));
      }
    } else {
      console.error('[getSalesDashboardData] Sales reps query failed:', salesRepsResult.reason);
      dashboardData.stats.totalActiveReps = 0;
    }

    // Process team leaders count
    if (teamLeadersResult.status === 'fulfilled') {
      const leaders = teamLeadersResult.value[0] || [];
      dashboardData.stats.activeTeamLeaders = Array.isArray(leaders) ? leaders.length : 0;
      console.log('[getSalesDashboardData] Active team leaders:', dashboardData.stats.activeTeamLeaders);
    } else {
      dashboardData.stats.activeTeamLeaders = 0;
      console.error('[getSalesDashboardData] Team leaders query failed:', teamLeadersResult.reason);
    }

    // Process checked-in sales reps count
    if (checkedInRepsResult.status === 'fulfilled') {
      const checkedInData = checkedInRepsResult.value[0] || [];
      dashboardData.stats.checkedInReps = checkedInData[0]?.checked_in_count || 0;
      dashboardData.stats.activeReps = dashboardData.stats.checkedInReps; // Keep for backward compatibility
      console.log('[getSalesDashboardData] Checked-in sales reps today:', dashboardData.stats.checkedInReps);
    } else {
      // Fallback if query fails
      dashboardData.stats.checkedInReps = 0;
      dashboardData.stats.activeReps = 0;
      console.error('[getSalesDashboardData] Checked-in query failed:', checkedInRepsResult.reason);
    }

    // Process checked-in team leaders count
    if (checkedInTeamLeadersResult.status === 'fulfilled') {
      const data = checkedInTeamLeadersResult.value[0] || [];
      dashboardData.stats.checkedInTeamLeaders = data[0]?.checked_in_team_leaders || 0;
      console.log('[getSalesDashboardData] Checked-in team leaders today:', dashboardData.stats.checkedInTeamLeaders);
    } else {
      dashboardData.stats.checkedInTeamLeaders = 0;
      console.error('[getSalesDashboardData] Checked-in team leaders query failed:', checkedInTeamLeadersResult.reason);
    }
    
    // Ensure we have valid numbers even if queries failed
    if (!dashboardData.stats.totalActiveReps && dashboardData.stats.totalActiveReps !== 0) {
      dashboardData.stats.totalActiveReps = 0;
    }
    if (!dashboardData.stats.checkedInReps && dashboardData.stats.checkedInReps !== 0) {
      dashboardData.stats.checkedInReps = 0;
    }
    if (currentMonthOutletsVisitedResult.status === 'fulfilled') {
      const currentMonthOutletsData = currentMonthOutletsVisitedResult.value[0] || [];
      dashboardData.stats.outletsVisitedThisMonth = Number(currentMonthOutletsData[0]?.outlets_visited_count) || 0;
    } else {
      dashboardData.stats.outletsVisitedThisMonth = 0;
      console.error('[getSalesDashboardData] Current month outlets visited query failed:', currentMonthOutletsVisitedResult.reason);
    }

    // Process targets
    let distTargets = [], keyTargets = [], retailTargets = [];
    if (targetsResult.status === 'fulfilled') {
      [distTargets, keyTargets, retailTargets] = [
        targetsResult.value[0][0],
        targetsResult.value[1][0],
        targetsResult.value[2][0]
      ];
      console.log('[getSalesDashboardData] Targets loaded');
    }

    // Process orders
    let orders = [];
    if (ordersResult.status === 'fulfilled') {
      orders = ordersResult.value[0];
      dashboardData.stats.totalOrders = orders.length;

      // Calculate monthly data
      const monthMap = {};
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      orders.forEach(order => {
        if (!order.order_date || !order.total_amount) return;
        
        const date = new Date(order.order_date);
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        const amount = Number(order.total_amount);
        
        monthMap[key] = (monthMap[key] || 0) + amount;
        dashboardData.stats.totalSales += amount;
      });

      // Convert to array and sort
      dashboardData.monthlyData = Object.entries(monthMap)
        .map(([key, amount]) => {
          const [year, monthIdx] = key.split('-');
          return {
            month: `${monthNames[Number(monthIdx)]} ${year}`,
            amount: amount,
            sortKey: `${year}-${String(Number(monthIdx) + 1).padStart(2, '0')}`
          };
        })
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .map(({ month, amount }) => ({ month, amount }));

      // Calculate new orders count (my_status = 0)
      dashboardData.newOrdersCount = orders.filter(o => o.my_status === 0 || o.my_status === '0').length;

      console.log('[getSalesDashboardData] Orders processed:', orders.length);
    }

    // Calculate sales performance by rep
    if (salesReps.length > 0 && orders.length > 0) {
      // Group orders by route
      const ordersByRoute = {};
      orders.forEach(order => {
        const routeId = order.route_id_update;
        if (!routeId) return;
        
        if (!ordersByRoute[routeId]) {
          ordersByRoute[routeId] = {
            dist: { orders: 0, sales: 0, outlets: new Set() },
            key: { orders: 0, sales: 0, outlets: new Set() },
            retail: { orders: 0, sales: 0, outlets: new Set() }
          };
        }

        const clientType = order.client_type;
        const amount = Number(order.total_amount) || 0;
        
        if (clientType === 3 || clientType === '3') {
          ordersByRoute[routeId].dist.orders++;
          ordersByRoute[routeId].dist.sales += amount;
          ordersByRoute[routeId].dist.outlets.add(order.client_id);
        } else if (clientType === 2 || clientType === '2') {
          ordersByRoute[routeId].key.orders++;
          ordersByRoute[routeId].key.sales += amount;
          ordersByRoute[routeId].key.outlets.add(order.client_id);
        } else if (clientType === 1 || clientType === '1') {
          ordersByRoute[routeId].retail.orders++;
          ordersByRoute[routeId].retail.sales += amount;
          ordersByRoute[routeId].retail.outlets.add(order.client_id);
        }
      });

      // Get total outlets per route per type
      const [clientsByRoute] = await db.query(`
        SELECT route_id_update, client_type, COUNT(*) as count
        FROM Clients
        WHERE route_id_update IS NOT NULL
        GROUP BY route_id_update, client_type
      `);

      const outletCounts = {};
      clientsByRoute.forEach(row => {
        const routeId = row.route_id_update;
        if (!outletCounts[routeId]) {
          outletCounts[routeId] = { dist: 0, key: 0, retail: 0 };
        }
        const type = row.client_type;
        const count = Number(row.count) || 0;
        
        if (type === 3 || type === '3') outletCounts[routeId].dist = count;
        else if (type === 2 || type === '2') outletCounts[routeId].key = count;
        else if (type === 1 || type === '1') outletCounts[routeId].retail = count;
      });

      // Calculate performance for each rep
      const repPerformance = salesReps.map(rep => {
        const routeId = rep.route_id_update;
        const routeData = ordersByRoute[routeId] || { dist: { orders: 0, sales: 0, outlets: new Set() }, key: { orders: 0, sales: 0, outlets: new Set() }, retail: { orders: 0, sales: 0, outlets: new Set() } };
        const outlets = outletCounts[routeId] || { dist: 0, key: 0, retail: 0 };

        // Get targets
        const distTarget = distTargets.find(t => t.sales_rep_id === rep.id) || { vapes_target: 0, pouches_target: 0 };
        const keyTarget = keyTargets.find(t => t.sales_rep_id === rep.id) || { vapes_target: 0, pouches_target: 0 };
        const retailTarget = retailTargets.find(t => t.sales_rep_id === rep.id) || { vapes_target: 0, pouches_target: 0 };

        // Calculate percentages for each type
        const types = [
          {
            name: 'distributors',
            target: (Number(distTarget.vapes_target) || 0) + (Number(distTarget.pouches_target) || 0),
            sales: routeData.dist.sales,
            totalOutlets: outlets.dist,
            outletsWithOrders: routeData.dist.outlets.size
          },
          {
            name: 'key_accounts',
            target: (Number(keyTarget.vapes_target) || 0) + (Number(keyTarget.pouches_target) || 0),
            sales: routeData.key.sales,
            totalOutlets: outlets.key,
            outletsWithOrders: routeData.key.outlets.size
          },
          {
            name: 'retail',
            target: (Number(retailTarget.vapes_target) || 0) + (Number(retailTarget.pouches_target) || 0),
            sales: routeData.retail.sales,
            totalOutlets: outlets.retail,
            outletsWithOrders: routeData.retail.outlets.size
          }
        ];

        let totalPct = 0;
        types.forEach(type => {
          const outletPct = type.totalOutlets > 0 ? (type.outletsWithOrders / type.totalOutlets) * 100 : 0;
          const salesPct = type.target > 0 ? (type.sales / type.target) * 100 : 0;
          totalPct += (outletPct + salesPct) / 2;
        });

        const overall = totalPct / types.length;

        return {
          name: rep.name,
          overall: Number(overall.toFixed(1))
        };
      });

      // Sort and get top 10
      repPerformance.sort((a, b) => b.overall - a.overall);
      dashboardData.topReps = repPerformance.slice(0, 10);

      // Calculate average performance
      if (repPerformance.length > 0) {
        const avgPerf = repPerformance.reduce((sum, rep) => sum + rep.overall, 0) / repPerformance.length;
        dashboardData.stats.avgPerformance = Number(avgPerf.toFixed(1));
      }

      console.log('[getSalesDashboardData] Performance calculated for', repPerformance.length, 'reps');
    }

    // Process leaves
    if (leavesResult.status === 'fulfilled') {
      dashboardData.pendingLeavesCount = leavesResult.value[0][0].pending_count || 0;
      console.log('[getSalesDashboardData] Pending leaves:', dashboardData.pendingLeavesCount);
    }

    // Process managers
    if (managersResult.status === 'fulfilled') {
      dashboardData.managers = managersResult.value[0];
      console.log('[getSalesDashboardData] Managers found:', dashboardData.managers.length);
    }

    // Process planogram compliance data
    if (planogramComplianceResult.status === 'fulfilled') {
      const complianceData = planogramComplianceResult.value[0] || [];
      // Reverse to show oldest to newest
      dashboardData.planogramComplianceData = complianceData.reverse().map(row => ({
        month: row.month,
        compliance: Number(row.compliance_percentage) || 0
      }));
      console.log('[getSalesDashboardData] Planogram compliance data loaded:', dashboardData.planogramComplianceData.length, 'months');
    } else {
      console.log('[getSalesDashboardData] Planogram compliance query failed:', planogramComplianceResult.reason);
    }

    // Process top products sold
    if (topProductsSoldResult.status === 'fulfilled') {
      const topProductsRows = topProductsSoldResult.value[0] || [];
      dashboardData.topProductsSold = topProductsRows.map(row => ({
        product_name: row.product_name,
        product_code: row.product_code,
        quantity: Number(row.total_quantity) || 0,
        amount: Number(row.total_amount) || 0
      }));
      console.log('[getSalesDashboardData] Top products sold loaded:', dashboardData.topProductsSold.length, 'products');
    } else {
      console.log('[getSalesDashboardData] Top products sold query failed:', topProductsSoldResult.reason);
    }

    const endTime = Date.now();
    console.log(`[getSalesDashboardData] Completed in ${endTime - startTime}ms`);
    console.log('[getSalesDashboardData] Final stats being sent:', {
      totalActiveReps: dashboardData.stats.totalActiveReps,
      checkedInReps: dashboardData.stats.checkedInReps,
      activeReps: dashboardData.stats.activeReps
    });

    res.json({
      success: true,
      data: dashboardData,
      performanceMs: endTime - startTime
    });

  } catch (err) {
    console.error('[getSalesDashboardData] Error:', err);
    console.error('[getSalesDashboardData] Stack:', err.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch dashboard data',
      message: err.message 
    });
  }
};

/**
 * Get product performance data (lazy loaded)
 */
exports.getProductPerformance = async (req, res) => {
  try {
    console.log('[getProductPerformance] Starting...');
    const { productType, startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate && endDate) {
      dateFilter = 'AND so.order_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    const typeFilter = productType ? 
      (productType === 'vape' ? 'AND p.category_id IN (1, 3)' : 'AND p.category_id IN (4, 5)') : '';

    const [products] = await db.query(`
      SELECT 
        p.id,
        p.product_name,
        p.category_id,
        SUM(soi.quantity) as total_quantity_sold,
        SUM(soi.quantity * soi.unit_price) as total_sales_value
      FROM products p
      LEFT JOIN sales_order_items soi ON p.id = soi.product_id
      LEFT JOIN sales_orders so ON soi.sales_order_id = so.id
      WHERE 1=1 ${dateFilter} ${typeFilter}
      GROUP BY p.id, p.product_name, p.category_id
      HAVING total_quantity_sold > 0
      ORDER BY total_sales_value DESC
    `, params);

    console.log('[getProductPerformance] Products found:', products.length);

    res.json({
      success: true,
      data: products
    });

  } catch (err) {
    console.error('[getProductPerformance] Error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch product performance',
      message: err.message 
    });
  }
};

/**
 * Get current month pie chart data (lazy loaded)
 */
exports.getCurrentMonthPieData = async (req, res) => {
  try {
    console.log('[getCurrentMonthPieData] Starting...');
    
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    const [results] = await db.query(`
      SELECT 
        CASE 
          WHEN p.category_id IN (1, 3) THEN 'Vapes'
          WHEN p.category_id IN (4, 5) THEN 'Pouches'
          ELSE 'Other'
        END as product_type,
        SUM(soi.quantity * soi.unit_price) as total_value
      FROM sales_order_items soi
      JOIN sales_orders so ON soi.sales_order_id = so.id
      JOIN products p ON soi.product_id = p.id
      WHERE so.order_date BETWEEN ? AND ?
      GROUP BY product_type
      HAVING product_type IN ('Vapes', 'Pouches')
    `, [startDate, endDate]);

    console.log('[getCurrentMonthPieData] Data calculated');

    res.json({
      success: true,
      data: results.map(r => ({
        type: r.product_type,
        value: Number(r.total_value) || 0
      }))
    });

  } catch (err) {
    console.error('[getCurrentMonthPieData] Error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch pie chart data',
      message: err.message 
    });
  }
};

/**
 * Get outlets visited per month (lazy loaded)
 * Returns unique outlets visited per month from JourneyPlan where status = 1 or 2
 */
exports.getOutletsVisited = async (req, res) => {
  try {
    console.log('[getOutletsVisited] Starting...');
    const { team_leader_id, region } = req.query;
    
    // Build filter conditions
    let joinClause = '';
    let whereConditions = ['jp.status IN (1, 2)', 'jp.clientId IS NOT NULL', 'jp.checkInTime IS NOT NULL'];
    let queryParams = [];
    
    // Filter by team leader if provided
    if (team_leader_id) {
      joinClause = 'INNER JOIN SalesRep sr ON jp.userId = sr.id';
      whereConditions.push('sr.leader_id = ?');
      queryParams.push(team_leader_id);
    }
    
    // Filter by region if provided
    if (region) {
      if (!joinClause) {
        joinClause = 'INNER JOIN SalesRep sr ON jp.userId = sr.id';
      }
      whereConditions.push('sr.region = ?');
      queryParams.push(region);
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    const [results] = await db.query(`
      SELECT 
        DATE_FORMAT(jp.checkInTime, '%Y-%m') as month_key,
        DATE_FORMAT(jp.checkInTime, '%b %Y') as month,
        COUNT(DISTINCT jp.clientId) as unique_outlets
      FROM JourneyPlan jp
      ${joinClause}
      ${whereClause}
      GROUP BY DATE_FORMAT(jp.checkInTime, '%Y-%m'), DATE_FORMAT(jp.checkInTime, '%b %Y')
      ORDER BY month_key DESC
      LIMIT 12
    `, queryParams);

    console.log('[getOutletsVisited] Outlets visited data calculated:', results.length, 'months');

    res.json({
      success: true,
      data: results.map(r => ({
        month: r.month,
        outlets: Number(r.unique_outlets) || 0
      })).reverse() // Reverse to show oldest to newest
    });

  } catch (err) {
    console.error('[getOutletsVisited] Error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch outlets visited data',
      message: err.message 
    });
  }
};

/**
 * Get orders summary per month (lazy loaded)
 * Returns total quantity from sales_order_items grouped by month
 */
exports.getOrdersSummary = async (req, res) => {
  try {
    console.log('[getOrdersSummary] Starting...');
    const { team_leader_id, region } = req.query;
    
    // Build filter conditions
    let joinClause = 'JOIN sales_orders so ON soi.sales_order_id = so.id';
    let whereConditions = ['so.order_date IS NOT NULL'];
    let queryParams = [];
    
    // Filter by team leader if provided
    if (team_leader_id || region) {
      joinClause += ' JOIN Clients c ON so.client_id = c.id';
      joinClause += ' JOIN SalesRep sr ON c.route_id_update = sr.route_id_update';
      
      if (team_leader_id) {
        whereConditions.push('sr.leader_id = ?');
        queryParams.push(team_leader_id);
      }
      
      if (region) {
        whereConditions.push('sr.region = ?');
        queryParams.push(region);
      }
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    const [results] = await db.query(`
      SELECT 
        DATE_FORMAT(so.order_date, '%Y-%m') as month_key,
        DATE_FORMAT(so.order_date, '%b %Y') as month,
        SUM(soi.quantity) as total_quantity
      FROM sales_order_items soi
      ${joinClause}
      ${whereClause}
      GROUP BY DATE_FORMAT(so.order_date, '%Y-%m'), DATE_FORMAT(so.order_date, '%b %Y')
      ORDER BY month_key DESC
      LIMIT 12
    `, queryParams);

    console.log('[getOrdersSummary] Orders summary data calculated:', results.length, 'months');

    res.json({
      success: true,
      data: results.map(r => ({
        month: r.month,
        quantity: Number(r.total_quantity) || 0
      })).reverse() // Reverse to show oldest to newest
    });

  } catch (err) {
    console.error('[getOrdersSummary] Error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch orders summary data',
      message: err.message 
    });
  }
};

/**
 * Get team leader dashboard data (filtered by team_leader_id and region)
 */
exports.getTeamLeaderDashboardData = async (req, res) => {
  try {
    const { team_leader_id, region } = req.query;
    
    if (!team_leader_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'team_leader_id is required' 
      });
    }
    
    console.log('[getTeamLeaderDashboardData] Starting for team_leader_id:', team_leader_id, 'region:', region);
    const startTime = Date.now();

    // Get current month date range
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    // Build filter conditions for sales reps
    let salesRepWhereConditions = ['sr.status = 1', 'sr.leader_id = ?'];
    let salesRepParams = [team_leader_id];
    
    if (region) {
      salesRepWhereConditions.push('sr.region = ?');
      salesRepParams.push(region);
    }
    
    const salesRepWhereClause = `WHERE ${salesRepWhereConditions.join(' AND ')}`;

    // Execute all queries in parallel
    const [
      salesRepsResult,
      ordersResult,
      leavesResult,
      planogramComplianceResult,
      checkedInRepsResult,
      currentMonthOutletsVisitedResult
    ] = await Promise.allSettled([
      // 1. Get sales reps assigned to this team leader
      db.query(`
        SELECT sr.id, sr.name, sr.status, sr.route_id_update, r.name as route_name, 
               r.region as region_name, sr.region
        FROM \`SalesRep\` sr
        LEFT JOIN \`routes\` r ON sr.route_id_update = r.id
        ${salesRepWhereClause}
        ORDER BY sr.name
      `, salesRepParams),

      // 2. Get orders for sales reps assigned to this team leader
      db.query(`
        SELECT 
          so.id,
          so.order_date,
          so.total_amount,
          so.my_status,
          so.client_id,
          c.client_type,
          c.route_id_update
        FROM sales_orders so
        LEFT JOIN Clients c ON so.client_id = c.id
        LEFT JOIN SalesRep sr ON c.route_id_update = sr.route_id_update
        WHERE so.order_date IS NOT NULL
          AND sr.leader_id = ?
          ${region ? 'AND sr.region = ?' : ''}
        ORDER BY so.order_date DESC
      `, region ? [team_leader_id, region] : [team_leader_id]),

      // 3. Get pending leaves count for team members
      db.query(`
        SELECT COUNT(*) as pending_count
        FROM leaves l
        INNER JOIN SalesRep sr ON l.user_id = sr.id
        WHERE (l.status = '0' OR l.status = 0)
          AND sr.leader_id = ?
          ${region ? 'AND sr.region = ?' : ''}
      `, region ? [team_leader_id, region] : [team_leader_id]),

      // 4. Get planogram compliance data
      db.query(`
        SELECT 
          DATE_FORMAT(pr.createdAt, '%Y-%m') as month_key,
          DATE_FORMAT(pr.createdAt, '%b %Y') as month,
          COALESCE(SUM(pc.compliance_quantity), 0) as total_target,
          COALESCE(SUM(pr.quantity), 0) as total_actual,
          CASE 
            WHEN COALESCE(SUM(pc.compliance_quantity), 0) > 0 
            THEN ROUND((COALESCE(SUM(pr.quantity), 0) / SUM(pc.compliance_quantity)) * 100, 1)
            ELSE 0 
          END as compliance_percentage
        FROM planogram_compliance pc
        LEFT JOIN outlet_accounts oa ON pc.outlet_account_id = oa.id
        LEFT JOIN Clients c ON c.outlet_account = pc.outlet_account_id
        LEFT JOIN SalesRep sr ON c.route_id_update = sr.route_id_update
        LEFT JOIN ProductReport pr ON pr.clientId = c.id AND pr.productId = pc.product_id
        WHERE pr.createdAt IS NOT NULL
          AND sr.leader_id = ?
          ${region ? 'AND sr.region = ?' : ''}
        GROUP BY DATE_FORMAT(pr.createdAt, '%Y-%m'), DATE_FORMAT(pr.createdAt, '%b %Y')
        HAVING total_target > 0
        ORDER BY month_key DESC
        LIMIT 12
      `, region ? [team_leader_id, region] : [team_leader_id]),

      // 5. Get count of checked-in team members
      db.query(`
        SELECT COUNT(DISTINCT jp.userId) as checked_in_count
        FROM \`JourneyPlan\` jp
        INNER JOIN \`SalesRep\` sr ON jp.userId = sr.id
        WHERE sr.status = 1
          AND sr.leader_id = ?
          ${region ? 'AND sr.region = ?' : ''}
          AND jp.checkInTime IS NOT NULL
          AND DATE(jp.checkInTime) = CURDATE()
      `, region ? [team_leader_id, region] : [team_leader_id]),

      // 6. Get unique outlets visited in current month
      db.query(`
        SELECT COUNT(DISTINCT jp.clientId) as outlets_visited_count
        FROM JourneyPlan jp
        INNER JOIN SalesRep sr ON jp.userId = sr.id
        WHERE jp.status IN (1, 2)
          AND jp.clientId IS NOT NULL
          AND jp.date BETWEEN ? AND ?
          AND sr.leader_id = ?
          ${region ? 'AND sr.region = ?' : ''}
      `, region ? [currentMonthStart, currentMonthEnd, team_leader_id, region] : [currentMonthStart, currentMonthEnd, team_leader_id])
    ]);

    // Process results
    const salesReps = salesRepsResult.status === 'fulfilled' ? (salesRepsResult.value[0] || []) : [];
    const orders = ordersResult.status === 'fulfilled' ? (ordersResult.value[0] || []) : [];
    const pendingLeaves = leavesResult.status === 'fulfilled' ? ((leavesResult.value[0] || [])[0]?.pending_count || 0) : 0;
    const planogramCompliance = planogramComplianceResult.status === 'fulfilled' ? (planogramComplianceResult.value[0] || []) : [];
    const checkedInCount = checkedInRepsResult.status === 'fulfilled' ? ((checkedInRepsResult.value[0] || [])[0]?.checked_in_count || 0) : 0;
    const outletsVisited = currentMonthOutletsVisitedResult.status === 'fulfilled' ? ((currentMonthOutletsVisitedResult.value[0] || [])[0]?.outlets_visited_count || 0) : 0;

    // Calculate stats
    const totalOrders = orders.length;
    const totalSales = orders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    
    // Calculate average performance (simplified - can be enhanced)
    const avgPerformance = salesReps.length > 0 ? (totalSales / salesReps.length) : 0;

    // Get top team members (by sales - simplified)
    const salesByRep = {};
    orders.forEach(order => {
      const repId = order.route_id_update; // Simplified - should get from proper join
      if (!salesByRep[repId]) {
        salesByRep[repId] = { name: 'Team Member', total: 0 };
      }
      salesByRep[repId].total += Number(order.total_amount) || 0;
    });
    
    const topTeamMembers = Object.values(salesByRep)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((m) => ({ name: m.name, overall: m.total }));

    const dashboardData = {
      stats: {
        teamMembers: salesReps.length,
        outletsVisitedThisMonth: outletsVisited,
        totalOrders: totalOrders,
        checkedInMembers: checkedInCount,
        totalActiveMembers: salesReps.length,
        avgTeamPerformance: avgPerformance,
      },
      planogramComplianceData: planogramCompliance.map((pc) => ({
        month: pc.month,
        compliance: Number(pc.compliance_percentage) || 0
      })).reverse(),
      topTeamMembers: topTeamMembers,
      pendingLeavesCount: pendingLeaves,
      newOrdersCount: 0, // Can be calculated if needed
    };

    const endTime = Date.now();
    console.log(`[getTeamLeaderDashboardData] Completed in ${endTime - startTime}ms`);

    res.json({
      success: true,
      data: dashboardData,
      performanceMs: endTime - startTime
    });

  } catch (err) {
    console.error('[getTeamLeaderDashboardData] Error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch team leader dashboard data',
      message: err.message 
    });
  }
};

/**
 * Get checked-in sales reps (filtered by team_leader_id and region)
 */
exports.getCheckedInSalesReps = async (req, res) => {
  try {
    const { team_leader_id, region, role, date } = req.query;
    // Optional ?date=YYYY-MM-DD (defaults to today, so existing callers are unaffected)
    const validDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    
    // Build WHERE conditions
    let whereConditions = [
      'sr.status = 1',
      'jp.checkInTime IS NOT NULL',
      validDate ? 'DATE(jp.checkInTime) = ?' : 'DATE(jp.checkInTime) = CURDATE()'
    ];
    let queryParams = validDate ? [validDate] : [];

    // Filter by role (default to sales rep / FMRs)
    if (role === 'leader') {
      whereConditions.push("LOWER(TRIM(sr.role)) = 'team leader'");
    } else {
      // default and any other value -> FMRs
      whereConditions.push("LOWER(TRIM(sr.role)) = 'sales rep'");
    }
    
    // Filter by team leader if provided (for team leader role)
    if (team_leader_id) {
      whereConditions.push('sr.leader_id = ?');
      queryParams.push(team_leader_id);
    } else if (req.user && req.user.role === 'leader') {
      // Auto-filter by current user if they are a team leader
      whereConditions.push('sr.leader_id = ?');
      queryParams.push(req.user.id);
    }
    
    // Filter by region if provided
    if (region) {
      whereConditions.push('sr.region = ?');
      queryParams.push(region);
    }
    
    const [results] = await db.query(`
      SELECT DISTINCT
        sr.id,
        sr.name,
        sr.email,
        r.name as route_name,
        sr.region as region_name,
        MAX(jp.checkInTime) as checkInTime,
        MAX(jp.checkoutTime) as checkoutTime,
        MAX(jp.latitude) as latitude,
        MAX(jp.longitude) as longitude
      FROM \`JourneyPlan\` jp
      INNER JOIN \`SalesRep\` sr ON jp.userId = sr.id
      LEFT JOIN \`routes\` r ON sr.route_id_update = r.id
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY sr.id, sr.name, sr.email, r.name, sr.region
      ORDER BY checkInTime DESC
    `, queryParams);

    console.log(`[getCheckedInSalesReps] Found ${results.length} checked-in sales reps`);

    res.json({
      success: true,
      data: results.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        route_name: r.route_name,
        region_name: r.region_name,
        checkInTime: r.checkInTime,
        checkoutTime: r.checkoutTime,
        latitude: r.latitude !== null && r.latitude !== undefined ? Number(r.latitude) : null,
        longitude: r.longitude !== null && r.longitude !== undefined ? Number(r.longitude) : null
      }))
    });

  } catch (err) {
    console.error('[getCheckedInSalesReps] Error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch checked-in sales reps',
      message: err.message 
    });
  }
};
