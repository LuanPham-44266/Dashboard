(function () {
  const ORDER_STATE_LABELS = {
    draft: 'Draft',
    sale: 'Sale',
    done: 'Done',
    cancel: 'Canceled'
  };

  const ROLE_RULES = {
    Sale: {
      show: ['#btn-new-order', '#btn-import-order', '#btn-order-filters'],
      hide: ['#btn-export', '#btn-revenue', '#btn-reporting', '#tab-reporting', '#btn-send-quote', '#btn-export-invoice'],
    },
    Accountant: {
      show: ['#tab-reporting', '#btn-reporting', '#btn-revenue', '#btn-export'],
      hide: ['#btn-new-order', '#btn-import-order', '#btn-order-filters', '#btn-send-quote', '#btn-export-invoice', '#tab-products'],
    },
    Manager: {
      show: ['#btn-new-order', '#btn-import-order', '#btn-order-filters', '#tab-products', '#tab-reporting', '#btn-reporting', '#btn-revenue', '#btn-export', '#btn-send-quote', '#btn-export-invoice'],
      hide: [],
    },
  };

  const state = {
    role: 'Manager',
    search: '',
    status: 'all',
    sortBy: 'date_order',
    order: 'desc',
    selectedOrderId: null,
    isFilterVisible: true,
    customers: [],
    products: [],
    reportingStartDate: '',
    reportingEndDate: '',
    editingProductId: null,
  };

  function buildProductOptions(products = []) {
    return (Array.isArray(products) ? products : [])
      .map((product) => `<option value="${product.id}">${product.name}</option>`)
      .join('');
  }

  function buildCustomerOptions(customers = []) {
    return (Array.isArray(customers) ? customers : [])
      .map((customer) => `<option value="${customer.id}">${customer.name}</option>`)
      .join('');
  }

  function resetOrderModalForm() {
    const tbody = document.getElementById('orderLinesBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const row = createOrderRow(state.products);
    tbody.appendChild(row);

   const customerSelect = document.getElementById('customerSelect');
      if (customerSelect) customerSelect.value = ''; // Reset input
      const customerPhone = document.getElementById('customerPhone');
      if (customerPhone) customerPhone.value = ''; // Clear phone
      const customerList = document.getElementById('customer-list');
      if (customerList) {
        customerList.innerHTML = (Array.isArray(state.customers) ? state.customers : [])
            .map((c) => `<option value="${c.name}" data-id="${c.id}"></option>`)
            .join('');
      }
    const orderDate = document.getElementById('orderDate');
    if (orderDate) {
      orderDate.value = new Date().toISOString().slice(0, 16);
    }

    updateTotals();
  }

  async function loadCustomersAndProductsIntoOrderModal() {
    try {
      const [customers, products] = await Promise.all([
        window.Api?.fetchCustomers ? window.Api.fetchCustomers() : [],
        window.Api?.fetchProducts ? window.Api.fetchProducts() : [],
      ]);

      state.customers = Array.isArray(customers) ? customers : [];
      state.products = Array.isArray(products) ? products : [];

      const customerSelect = document.getElementById('customerSelect');
      if (customerSelect) customerSelect.value = ''; // Reset input
      const customerList = document.getElementById('customer-list');
      if (customerList) {
        customerList.innerHTML = (Array.isArray(state.customers) ? state.customers : [])
            .map((c) => `<option value="${c.name}" data-id="${c.id}"></option>`)
            .join('');
      }

      const orderLinesBody = document.getElementById('orderLinesBody');
      if (orderLinesBody) {
        if (!orderLinesBody.children.length) {
          orderLinesBody.innerHTML = '';
          orderLinesBody.appendChild(createOrderRow(state.products));
        } else {
          orderLinesBody.querySelectorAll('.line-product-select').forEach((select) => {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Select product</option>' + buildProductOptions(state.products);
            if (currentValue) {
              select.value = currentValue;
            }
          });
        }
      }

      updateTotals();
    } catch (error) {
      console.error('Failed to load order modal data', error);
      showToast('Không thể tải khách hàng/sản phẩm.', 'error');
    }
  }

  function toggleOrderModalState(orderStatus, isNew = false, invoiceStatus = null) {
    const confirmOrderBtn = document.getElementById('confirmOrderBtn'); 
    const confirmSaleBtn = document.getElementById('confirmSaleBtn'); 
    const markDoneBtn = document.getElementById('markDoneBtn'); 
    const addLineBtn = document.getElementById('addLineBtn'); 
    const btnSendQuote = document.getElementById('btn-send-quote');
    const deleteOrderBtn = document.getElementById('deleteOrderBtn');
    const saveChangesBtn = document.getElementById('saveChangesBtn');

    const createInvoiceBtn = document.getElementById('btn-create-invoice');
    const btnExportInvoice = document.getElementById('btn-export-invoice'); 
    const confirmInvoiceBtn = document.getElementById('btn-confirm-invoice');
    const registerPaymentBtn = document.getElementById('btn-register-payment');
    const invoiceStatusContainer = document.getElementById('invoiceStatusContainer');
    const invoiceStatusText = document.getElementById('invoiceStatusText');

    const normalizedStatus = String(orderStatus || 'draft').toLowerCase();
    const isReadOnly = (normalizedStatus !== 'draft' && normalizedStatus !== 'pending');

    // Cập nhật Pipeline active state
    document.querySelectorAll('#statusPipeline .pipeline-step').forEach(step => {
      const stepState = step.dataset.state;
      if (stepState === normalizedStatus) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    });

    document.querySelectorAll('#orderModal input, #orderModal select').forEach(el => {
      el.disabled = isReadOnly;
    });

    document.querySelectorAll('.remove-line-btn').forEach(btn => {
      btn.style.display = isReadOnly ? 'none' : 'inline-block';
    });

    if (addLineBtn) {
      if (!isReadOnly) addLineBtn.classList.remove('hidden');
      else addLineBtn.classList.add('hidden');
    }

    if (saveChangesBtn) {
      if (!isReadOnly && !isNew) saveChangesBtn.classList.remove('hidden');
      else saveChangesBtn.classList.add('hidden');
    }

    if (confirmSaleBtn) {
      if (normalizedStatus === 'draft' && !isNew) confirmSaleBtn.classList.remove('hidden');
      else confirmSaleBtn.classList.add('hidden');
    }

    if (markDoneBtn) {
      if (normalizedStatus === 'sale') markDoneBtn.classList.remove('hidden');
      else markDoneBtn.classList.add('hidden');
    }

    if (confirmOrderBtn) {
      if (isNew) confirmOrderBtn.classList.remove('hidden');
      else confirmOrderBtn.classList.add('hidden');
    }

    if (btnSendQuote) {
      if (!isReadOnly && !isNew) btnSendQuote.classList.remove('hidden');
      else btnSendQuote.classList.add('hidden');
    }

    if (deleteOrderBtn) {
      if (!isReadOnly && !isNew) deleteOrderBtn.classList.remove('hidden');
      else deleteOrderBtn.classList.add('hidden');
    }

    // Logic Invoice
    const btnSendInvoice = document.getElementById('btn-send-invoice');
    
    if (createInvoiceBtn) createInvoiceBtn.classList.add('hidden');
    if (confirmInvoiceBtn) confirmInvoiceBtn.classList.add('hidden');
    if (registerPaymentBtn) registerPaymentBtn.classList.add('hidden');
    if (btnSendInvoice) btnSendInvoice.classList.add('hidden');
    if (btnExportInvoice) btnExportInvoice.classList.add('hidden');

    if (invoiceStatusContainer) {
      invoiceStatusContainer.classList.remove('hidden');
      if (!invoiceStatus) {
        invoiceStatusText.textContent = 'Not Created';
        invoiceStatusText.className = 'badge bg-secondary';
        // Sửa lỗi: Chỉ hiện Create Invoice khi đơn ở trạng thái Sale hoặc Done
        if ((normalizedStatus === 'sale' || normalizedStatus === 'done') && createInvoiceBtn) {
            createInvoiceBtn.classList.remove('hidden');
        }
      } else {
        const invStatusStr = String(invoiceStatus).toLowerCase();
        invoiceStatusText.textContent = invoiceStatus.toUpperCase();
        if (invStatusStr === 'draft') {
          invoiceStatusText.className = 'badge bg-warning';
          if (confirmInvoiceBtn) confirmInvoiceBtn.classList.remove('hidden');
        } else if (invStatusStr === 'posted') {
          invoiceStatusText.className = 'badge bg-primary';
          if (btnSendInvoice) btnSendInvoice.classList.remove('hidden');
          if (registerPaymentBtn) registerPaymentBtn.classList.remove('hidden');
        } else if (invStatusStr === 'paid') {
          invoiceStatusText.className = 'badge bg-success';
          if (btnExportInvoice) btnExportInvoice.classList.remove('hidden');
        }
      }
    }
  }

  async function openCreateOrderModal() {
    const orderModal = document.getElementById('orderModal');
    if (!orderModal) return;

    orderModal.classList.remove('hidden');

    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.textContent = 'Create Order';

    await loadCustomersAndProductsIntoOrderModal();
    resetOrderModalForm();
    if (typeof bindOrderDetailEvents === 'function') {
      bindOrderDetailEvents();
    }
    
    toggleOrderModalState('draft', true);
  }
  
  function createOrderRow(products = state.products) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <select class="line-product-select">
          <option value="">Select product</option>
          ${buildProductOptions(products)}
        </select>
      </td>
      <td><input class="line-qty" type="number" min="1" value="1" /></td>
      <td><input class="line-price" type="number" min="0" step="0.01" value="0" /></td>
      <td class="line-subtotal">0₫</td>
      <td><button type="button" class="btn btn-link remove-line-btn">Remove</button></td>
    `;

    const productSelect = row.querySelector('.line-product-select');
    if (productSelect) {
      productSelect.addEventListener('change', () => {
        const productId = Number(productSelect.value || 0);
        const matchedProduct = state.products.find((item) => Number(item.id) === productId);
        const priceInput = row.querySelector('.line-price');
        if (priceInput) {
          priceInput.value = matchedProduct ? Number(matchedProduct.list_price || 0) : 0;
        }
        calculateSubtotalForRow(row);
        updateTotals();
      });
    }

    bindOrderLineCalculation(row);
    return row;
  }

  function calculateSubtotalForRow(row) {
    const qtyInput = row?.querySelector('.line-qty');
    const priceInput = row?.querySelector('.line-price');
    const subtotalEl = row?.querySelector('.line-subtotal');
    if (!qtyInput || !priceInput || !subtotalEl) return;

    const qty = Number(qtyInput.value || 0);
    const price = Number(priceInput.value || 0);
    const subtotal = qty * price;
    subtotalEl.textContent = `${subtotal.toLocaleString('vi-VN')}₫`;
  }

  function getOrderLinesFromTable() {
    const rows = document.querySelectorAll('#orderLinesBody tr');
    return Array.from(rows)
      .map((row) => {
        const productSelect = row.querySelector('.line-product-select');
        const qtyInput = row.querySelector('.line-qty');
        const priceInput = row.querySelector('.line-price');
        const productName = productSelect?.selectedOptions?.[0]?.text || '';

        const productId = productSelect ? Number(productSelect.value || 0) : 0;
        const qty = qtyInput ? Number(qtyInput.value || 0) : 0;
        const price = priceInput ? Number(priceInput.value || 0) : 0;

        return {
          product_id: productId,
          product_name: productName,
          quantity: qty,
          price_unit: price,
        };
      })
      .filter((line) => Number(line.product_id) > 0 && Number(line.quantity) > 0 && Number(line.price_unit) >= 0);
  }

  function updateTotals() {
    const rows = document.querySelectorAll('#orderLinesBody tr');
    let total = 0;

    rows.forEach((row) => {
      const qtyInput = row.querySelector('.line-qty');
      const priceInput = row.querySelector('.line-price');
      const qty = Number(qtyInput?.value || 0);
      const price = Number(priceInput?.value || 0);
      total += qty * price;
    });

    const untaxedEl = document.getElementById('amountUntaxed');
    const totalEl = document.getElementById('amountTotal');
    if (untaxedEl) untaxedEl.textContent = `${total.toLocaleString('vi-VN')}₫`;
    if (totalEl) totalEl.textContent = `${total.toLocaleString('vi-VN')}₫`;
  }

  function bindOrderLineCalculation(row) {
    if (!row) return;

    const qtyInput = row.querySelector('.line-qty');
    const priceInput = row.querySelector('.line-price');
    if (qtyInput) {
      qtyInput.addEventListener('input', () => {
        calculateSubtotalForRow(row);
        updateTotals();
      });
    }

    if (priceInput) {
      priceInput.addEventListener('input', () => {
        calculateSubtotalForRow(row);
        updateTotals();
      });
    }

    const removeBtn = row.querySelector('.remove-line-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        row.remove();
        updateTotals();
      });
    }
  }

  async function handleCreateOrderFromModal() {
    try {
      const customerSelect = document.getElementById('customerSelect');
      const customerInputValue = customerSelect ? String(customerSelect.value).trim() : '';
      const customerPhoneEl = document.getElementById('customerPhone');
      const partnerPhone = customerPhoneEl ? String(customerPhoneEl.value).trim() : '';
      
      const matchedCustomer = state.customers.find(c => c.name === customerInputValue || String(c.id) === customerInputValue);
      const partnerId = matchedCustomer ? Number(matchedCustomer.id) : 0;
      const partnerName = matchedCustomer ? '' : customerInputValue;

      const orderDateEl = document.getElementById('orderDate');
      const dateOrder = orderDateEl && orderDateEl.value ? new Date(orderDateEl.value).toISOString() : new Date().toISOString();
      const lines = getOrderLinesFromTable();

      if (!partnerId && !partnerName) {
        showToast('Vui lòng chọn khách hàng.', 'error');
        return;
      }

      if (!lines.length) {
        showToast('Đơn hàng cần ít nhất 1 sản phẩm.', 'error');
        return;
      }

      const payload = {
        partner_id: partnerId,
        partner_name: partnerName,
        partner_phone: partnerPhone,
        date_order: dateOrder,
        lines: lines.map((line) => ({
          product_id: Number(line.product_id),
          quantity: Number(line.quantity),
          price_unit: Number(line.price_unit),
        })),
      };

      const result = await window.Api.createOrder(payload);
      showToast(result?.message || 'Đã lưu đơn nháp thành công.', 'success');
      
      refreshOrdersList();
      if (typeof loadReportingData === 'function') await loadReportingData();

      if (result.order && result.order.id) {
        openOrderDetail(result.order.id);
      }
      const orderModal = document.getElementById('orderModal');
      if (orderModal) orderModal.classList.add('hidden');
      const refreshedOrders = await window.Api?.fetchOrders?.({
        search: state.search,
        status: state.status,
        sortBy: state.sortBy,
        order: state.order,
      });
      renderOrders(Array.isArray(refreshedOrders) ? refreshedOrders : []);

      if (typeof loadReportingData === 'function') {
        await loadReportingData();
      } else if (typeof hydrateRevenueStats === 'function') {
        await hydrateRevenueStats();
      }
    } catch (error) {
      console.error('handleCreateOrderFromModal failed:', error);
      showToast(error?.message || 'Không thể tạo đơn hàng.', 'error');
    }
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    try {
      const toast = document.createElement('div');
      toast.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
      toast.textContent = message;
      container.appendChild(toast);

      setTimeout(() => {
        if (!toast || !toast.parentNode) return;
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 260);
      }, 2200);
    } catch (error) {
      console.error('showToast failed:', error);
    }
  }

  function setVisible(selector, visible) {
    const element = document.querySelector(selector);
    if (!element) return;
    element.style.display = visible ? '' : 'none';
  }

  function setTabActive(tabId) {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach((tab) => {
      if (!tab) return;
      tab.classList.toggle('active', tab.id === tabId);
    });

    const views = document.querySelectorAll('.screen-view');
    views.forEach((view) => {
      if (!view) return;
      const shouldShow =
        view.id === `${tabId.replace('tab-', '')}View` ||
        (tabId === 'tab-orders' && view.id === 'ordersView') ||
        (tabId === 'tab-reporting' && view.id === 'reportingView') ||
        (tabId === 'tab-products' && view.id === 'productsView');
      view.classList.toggle('hidden', !shouldShow);
      view.classList.toggle('active', shouldShow);
    });
  }

  function switchView(viewName) {
    if (viewName === 'orders') {
      setTabActive('tab-orders');
      return;
    }
    if (viewName === 'products') {
      setTabActive('tab-products');
      try {
        const loadProducts = async () => {
          try {
            const products = await window.Api?.fetchProducts?.();
            renderProducts(Array.isArray(products) ? products : []);
          } catch (error) {
            console.error('Failed to load products:', error);
            renderProducts([]);
            showToast(error?.message || 'Không thể tải sản phẩm.', 'error');
          }
        };
        loadProducts();
      } catch (error) {
        console.error('Products view init failed:', error);
      }
      return;
    }
    if (viewName === 'reporting') {
      setTabActive('tab-reporting');
      loadReportingData();
      return;
    }
  }

  function bindProductActionLinks() {
    const productsBody = document.getElementById('productsBody');
    if (!productsBody) return;

    productsBody.querySelectorAll('.dropdown-toggle').forEach((button) => {
      button.onclick = (event) => {
        event?.preventDefault?.();
        const menu = button.nextElementSibling;
        if (!menu) return;
        const isOpen = menu.classList.contains('show');
        menu.classList.toggle('show', !isOpen);
        menu.classList.toggle('hidden', isOpen);
        button.setAttribute('aria-expanded', String(!isOpen));
      };
    });

    productsBody.querySelectorAll('.product-action').forEach((link) => {
      link.onclick = async (event) => {
        event?.preventDefault?.();
        const productId = link.dataset.productId;
        const action = link.dataset.action;
        if (!productId || !action) return;
        await handleProductAction(productId, action);
      };
    });

    productsBody.querySelectorAll('.btn-edit, .btn-delete').forEach((button) => {
      button.onclick = async (event) => {
        event?.preventDefault?.();
        const productId = button.dataset.productId || button.closest('[data-product-id]')?.dataset?.productId;
        if (!productId) return;

        if (button.classList.contains('btn-delete')) {
          const confirmed = window.confirm('Bạn có chắc muốn xóa?');
          if (!confirmed) return;
          try {
            await window.Api?.deleteProduct?.(productId);
            showToast('Xóa sản phẩm thành công.', 'success');
            const products = await window.Api?.fetchProducts?.();
            state.products = Array.isArray(products) ? products : [];
            renderProducts(state.products);
            if (typeof loadReportingData === 'function') await loadReportingData();
          } catch (error) {
            showToast(error?.message || 'Không thể xóa sản phẩm.', 'error');
          }
          return;
        }

        if (button.classList.contains('btn-edit')) {
          console.log('Edit product', productId);
          const product = (state.products || []).find((item) => Number(item.id) === Number(productId));
          openProductModal(product || { id: productId });
        }
      };
    });
  }

  function renderProducts(products = []) {
    try {
      const productsBody = document.getElementById('productsBody');
      if (!productsBody) return;

      if (!Array.isArray(products) || !products.length) {
        productsBody.innerHTML = '<tr><td colspan="3" class="empty-row">No products found.</td></tr>';
        return;
      }

      productsBody.innerHTML = products
        .map((product) => `
          <tr>
            <td>${product?.name || '-'}</td>
            <td>${formatMoney(product?.list_price ?? product?.price ?? 0)}</td>
            <td>
              <div class="dropdown">
                <button type="button" class="btn btn-link dropdown-toggle" aria-expanded="false" data-product-id="${product?.id ?? ''}">More</button>
                <div class="dropdown-menu hidden">
                  <a href="#" class="dropdown-item product-action btn-edit" data-action="edit" data-product-id="${product?.id ?? ''}">Edit</a>
                  <a href="#" class="dropdown-item product-action btn-delete" data-action="delete" data-product-id="${product?.id ?? ''}">Delete</a>
                </div>
              </div>
            </td>
          </tr>
        `)
        .join('');

      bindProductActionLinks();
    } catch (error) {
      console.error('renderProducts failed:', error);
      const productsBody = document.getElementById('productsBody');
      if (productsBody) {
        productsBody.innerHTML = '<tr><td colspan="3" class="empty-row">No products found.</td></tr>';
      }
    }
  }

  function applyUIByRole(role) {
    const normalizedRole = String(role || 'Manager').trim();
    const rule = ROLE_RULES[normalizedRole] || ROLE_RULES.Manager;

    const allSelectors = [
      '#btn-new-order',
      '#btn-import-order',
      '#btn-order-filters',
      '#btn-import-product',
      '#btn-export-product',
      '#btn-export',
      '#btn-revenue',
      '#btn-reporting',
      '#btn-send-quote',
      '#btn-export-invoice',
      '#tab-reporting',
      '#tab-products',
    ];

    allSelectors.forEach((selector) => setVisible(selector, false));
    rule.show.forEach((selector) => setVisible(selector, true));
    rule.hide.forEach((selector) => setVisible(selector, false));

    const tabOrders = document.getElementById('tab-orders');
    if (tabOrders) {
      tabOrders.style.display = normalizedRole === 'Accountant' ? 'none' : '';
    }

    const revenueCard = document.getElementById('revenueStatCard');
    if (revenueCard) {
      revenueCard.style.display = ['Accountant', 'Manager'].includes(normalizedRole) ? '' : 'none';
    }

    if (normalizedRole === 'Sale') {
      setTabActive('tab-orders');
    } else if (normalizedRole === 'Accountant') {
      setTabActive('tab-reporting');
    } else {
      setTabActive('tab-orders');
    }
  }

  function formatMoney(value) {
    const numeric = Number(value || 0);
    return `${Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0'} đ`;
  }

  function formatShortMoney(value) {
    const numeric = Number(value || 0);
    return `${Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0'}đ`;
  }

  function formatDate(value) {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  function getStatusBadgeClass(statusValue) {
    const value = String(statusValue || '').toLowerCase();
    if (value === 'done') return 'bg-success';
    if (value === 'sale') return 'bg-primary';
    if (value === 'draft') return 'bg-secondary';
    if (value === 'cancel') return 'bg-danger';
    return 'bg-secondary';
  }

  function calculateAndRenderStats(orders = []) {
    try {
      const orderList = Array.isArray(orders) ? orders : [];
      
      const draftOrders = orderList.filter(o => String(o?.state || '').toLowerCase() === 'draft');
      const revenueOrders = orderList.filter((order) => {
        const stateValue = String(order?.state || '').toLowerCase();
        return stateValue === 'done' || stateValue === 'sale';
      });

      const totalOrders = orderList.length;
      const totalRevenue = revenueOrders.reduce((sum, order) => {
        const rawAmount = Number(order?.amount_total ?? order?.amount ?? 0);
        return sum + (Number.isFinite(rawAmount) ? rawAmount : 0);
      }, 0);

      const totalOrdersEl = document.getElementById('stat-total-orders');
      if (totalOrdersEl) totalOrdersEl.innerText = String(totalOrders);

      const draftQuotesEl = document.getElementById('stat-draft-quotes');
      if (draftQuotesEl) draftQuotesEl.innerText = String(draftOrders.length);

      const totalRevenueEl = document.getElementById('stat-total-revenue');
      if (totalRevenueEl) totalRevenueEl.innerText = formatShortMoney(totalRevenue);

      const reportingTotalEl = document.getElementById('reportingTotalRevenue');
      if (reportingTotalEl) reportingTotalEl.innerText = formatMoney(totalRevenue);

      return { totalOrders, totalRevenue, validOrders: revenueOrders };
    } catch (error) {
      console.error('calculateAndRenderStats failed:', error);
      const fallbackOrderEl = document.getElementById('stat-total-orders');
      if (fallbackOrderEl) fallbackOrderEl.innerText = '0';
      const draftQuotesEl = document.getElementById('stat-draft-quotes');
      if (draftQuotesEl) draftQuotesEl.innerText = '0';
      const fallbackRevenueEl = document.getElementById('stat-total-revenue');
      if (fallbackRevenueEl) fallbackRevenueEl.innerText = '0đ';
      const reportingTotalEl = document.getElementById('reportingTotalRevenue');
      if (reportingTotalEl) reportingTotalEl.innerText = '0 đ';
      return { totalOrders: 0, totalRevenue: 0, validOrders: [] };
    }
  }

  async function hydrateRevenueStats() {
    const totalOrdersEl = document.getElementById('stat-total-orders');
    const totalRevenueEl = document.getElementById('stat-total-revenue');

    if (totalOrdersEl) totalOrdersEl.innerText = '...';
    if (totalRevenueEl) totalRevenueEl.innerText = 'Loading...';

    try {
      const orders = window.Api?.fetchRevenueData ? await window.Api.fetchRevenueData() : [];
      calculateAndRenderStats(Array.isArray(orders?.data) ? orders.data : orders);
    } catch (error) {
      console.error('Failed to hydrate revenue stats', error);
      if (totalOrdersEl) totalOrdersEl.innerText = '0';
      if (totalRevenueEl) totalRevenueEl.innerText = '0đ';
      showToast(error?.message || 'Không thể tải dữ liệu doanh thu.', 'error');
    }
  }

  function resetProductModal() {
    state.editingProductId = null;
    const productNameInput = document.getElementById('productNameInput');
    const productPriceInput = document.getElementById('productPriceInput');
    const productModalTitle = document.getElementById('productModalTitle');
    if (productNameInput) productNameInput.value = '';
    if (productPriceInput) productPriceInput.value = '';
    if (productModalTitle) productModalTitle.textContent = 'Create Product';
    const productModal = document.getElementById('productModal');
    if (productModal) productModal.classList.add('hidden');
  }

  function openProductModal(product = null) {
    const productModal = document.getElementById('productModal');
    const productModalTitle = document.getElementById('productModalTitle');
    const productNameInput = document.getElementById('productNameInput');
    const productPriceInput = document.getElementById('productPriceInput');

    state.editingProductId = product ? Number(product.id) : null;
    if (productModal) productModal.classList.remove('hidden');
    if (productModalTitle) {
      productModalTitle.textContent = product ? 'Edit Product' : 'Create Product';
    }
    if (productNameInput) productNameInput.value = product ? String(product.name || '') : '';
    if (productPriceInput) productPriceInput.value = product ? Number(product.list_price ?? product.price ?? 0) : '';
    productNameInput?.focus?.();
  }

  async function handleProductAction(productId, action) {
    const product = (state.products || []).find((item) => Number(item.id) === Number(productId));

    if (action === 'edit') {
      openProductModal(product || { id: productId });
      return;
    }

    if (action === 'delete') {
      const confirmed = window.confirm('Bạn có chắc muốn xóa sản phẩm này?');
      if (!confirmed) return;

      try {
        await window.Api?.deleteProduct?.(productId);
        showToast('Xóa sản phẩm thành công.', 'success');
        const products = await window.Api?.fetchProducts?.();
        state.products = Array.isArray(products) ? products : [];
        renderProducts(state.products);
      } catch (error) {
        showToast(error?.message || 'Không thể xóa sản phẩm.', 'error');
      }
    }
  }

  async function loadReportingData() {
    try {
      const report = await window.Api?.fetchRevenueData?.(state.reportingStartDate, state.reportingEndDate);
      const rows = Array.isArray(report) ? report : Array.isArray(report?.data) ? report.data : [];
      const revenueRows = rows.filter(item => {
        const itemState = String(item.state || '').toLowerCase();
        return itemState === 'sale' || itemState === 'done';
      });
      const totalRevenue = revenueRows.reduce((sum, item) => sum + Number(item?.amount_total ?? item?.amount ?? 0), 0);
      
      renderRevenueReport({ total_revenue: totalRevenue, data: rows });
      calculateAndRenderStats(rows);
      return { total_revenue: totalRevenue, data: rows };
    } catch (error) {
      console.error('Failed to load reporting data:', error);
      renderRevenueReport({ total_revenue: 0, data: [] });
      showToast(error?.message || 'Không thể tải báo cáo doanh thu.', 'error');
      return { total_revenue: 0, data: [] };
    }
  }

  async function openOrderDetail(orderId) {
    if (!orderId) return;

    try {
      const order = await window.Api?.fetchOrderDetails?.(orderId);
      if (!order) throw new Error('Không có dữ liệu đơn hàng.');

      state.selectedOrderId = Number(orderId);
      const orderPayload = order.order || order;
      const lines = Array.isArray(order.lines) ? order.lines : (Array.isArray(orderPayload.lines) ? orderPayload.lines : []);

      const customerSelect = document.getElementById('customerSelect');
      if (customerSelect) {
        customerSelect.value = orderPayload.customer_name || orderPayload.partner_name || orderPayload.partner_id || '';
      }
      const customerPhone = document.getElementById('customerPhone');
      if (customerPhone) {
        customerPhone.value = orderPayload.phone || orderPayload.customer_phone || '';
      }

      const orderDate = document.getElementById('orderDate');
      if (orderDate) {
        orderDate.value = orderPayload.date_order ? new Date(orderPayload.date_order).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
      }

      const tbody = document.getElementById('orderLinesBody');
      if (tbody) {
        tbody.innerHTML = '';
        lines.forEach((line) => {
          const row = createOrderRow(state.products);
          const productSelect = row.querySelector('.line-product-select');
          if (productSelect) {
            productSelect.value = line.product_id || line.productId || '';
          }
          const qtyInput = row.querySelector('.line-qty');
          if (qtyInput) qtyInput.value = line.quantity || line.product_uom_qty || 1;
          const priceInput = row.querySelector('.line-price');
          if (priceInput) priceInput.value = line.price_unit || line.price || 0;
          tbody.appendChild(row);
          calculateSubtotalForRow(row);
          bindOrderLineCalculation(row);
        });

        if (!tbody.children.length) {
          tbody.appendChild(createOrderRow(state.products));
        }
      }

      const modal = document.getElementById('orderModal');
      const modalTitle = document.getElementById('modalTitle');
      if (modal) modal.classList.remove('hidden');
      if (modalTitle) modalTitle.textContent = 'Edit Order';
      updateTotals();
      
      // Lấy thông tin hóa đơn từ dữ liệu trả về
      state.currentInvoiceId = orderPayload.invoice_id || null;
      const invoiceState = orderPayload.invoice_state || null;
      toggleOrderModalState(orderPayload.state || 'draft', false, invoiceState);
    } catch (error) {
      console.error('openOrderDetail failed:', error);
      showToast(error?.message || 'Không thể tải chi tiết đơn hàng.', 'error');
    }
  }

  function showOrderDetail(orderId) {
    return openOrderDetail(orderId);
  }

  function renderOrders(orders = []) {
    state.orders = Array.isArray(orders) ? orders : [];
    const ordersTableBody = document.getElementById('ordersBody');
    if (!ordersTableBody) return;

    try {
      if (!state.orders.length) {
        ordersTableBody.innerHTML = '<tr><td colspan="8" class="empty-row">No orders found.</td></tr>';
        return;
      }

      ordersTableBody.innerHTML = state.orders
        .map((order) => {
          const orderName = order?.order_name || order?.name || 'Order';
          const customerName = order?.customer_name || order?.partner_name || 'Khách lẻ';
          const statusValue = String(order?.state || 'draft').toLowerCase();
          const statusLabel = ORDER_STATE_LABELS[statusValue] || 'Draft';
          const amount = Number(order?.amount_total ?? order?.amount ?? 0);
          const itemCount = Number(order?.item_count ?? 0);
          const orderId = Number(order?.id || 0);

          return `
            <tr data-order-id="${orderId}" class="order-row" tabindex="0">
              <td class="check-col"><input type="checkbox" /></td>
              <td>${orderName}</td>
              <td>${customerName}</td>
              <td>${order?.phone || '-'}</td>
              <td>${formatDate(order?.date_order)}</td>
              <td><span class="badge ${getStatusBadgeClass(statusValue)}">${statusLabel}</span></td>
              <td>${itemCount}</td>
              <td class="amount-col">${formatMoney(amount)}</td>
            </tr>
          `;
        })
        .join('');

      ordersTableBody.querySelectorAll('.order-row').forEach((row) => {
        row.addEventListener('click', (event) => {
          if (!row || !event?.target) return;
          if (event.target.closest('input[type="checkbox"]')) return;

          const orderId = row.dataset.orderId;
          ordersTableBody.querySelectorAll('.order-row').forEach((item) => item.classList.remove('selected-row'));
          row.classList.add('selected-row');
          state.selectedOrderId = orderId;
          openOrderDetail(orderId);
        });
      });
    } catch (error) {
      console.error('renderOrders failed:', error);
      ordersTableBody.innerHTML = '<tr><td colspan="8" class="empty-row">No orders found.</td></tr>';
    }
  }

  function handleReporting() {
    setTabActive('tab-reporting');
    loadReportingData(); 
  }

  function handleExport() {
    showToast('Export feature is not implemented yet.', 'info');
  }

  function bindOrderFilters() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        state.search = event.target.value;
        clearTimeout(state.searchTimeout);
        state.searchTimeout = setTimeout(() => {
          refreshOrdersList();
        }, 300);
      });
    }

    const statusSelect = document.getElementById('statusFilter');
    if (statusSelect) {
      statusSelect.addEventListener('change', (event) => {
        state.status = event.target.value;
        refreshOrdersList();
      });
    }

    const sortBySelect = document.querySelector('[data-sort]');
    if (sortBySelect) {
      sortBySelect.addEventListener('click', () => {
        const nextOrder = state.order === 'desc' ? 'asc' : 'desc';
        state.order = nextOrder;
        refreshOrdersList();
      });
    }
  }

  function bindReportingDateFilters() {
    const startInput = document.getElementById('reportingStartDate');
    const endInput = document.getElementById('reportingEndDate');
    const refreshBtn = document.getElementById('btn-revenue-refresh');
    const filterBtn = document.getElementById('btn-reporting-filter');

    if (startInput) {
      startInput.addEventListener('change', (event) => {
        state.reportingStartDate = event.target.value || '';
        if (state.reportingStartDate && state.reportingEndDate && state.reportingStartDate > state.reportingEndDate) {
          state.reportingEndDate = state.reportingStartDate;
          if (endInput) endInput.value = state.reportingEndDate;
        }
        loadReportingData();
      });
    }

    if (endInput) {
      endInput.addEventListener('change', (event) => {
        state.reportingEndDate = event.target.value || '';
        if (state.reportingStartDate && state.reportingEndDate && state.reportingStartDate > state.reportingEndDate) {
          state.reportingStartDate = state.reportingEndDate;
          if (startInput) startInput.value = state.reportingStartDate;
        }
        loadReportingData();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadReportingData();
      });
    }

    if (filterBtn) {
      filterBtn.addEventListener('click', async () => {
        try {
          const report = await window.Api?.fetchRevenueData?.(state.reportingStartDate, state.reportingEndDate);
          const rows = Array.isArray(report?.data) ? report.data : Array.isArray(report) ? report : [];
          const filteredRows = rows.filter((item) => {
            const itemDate = item?.date_order || item?.created_at || item?.date || item?.order_date || '';
            if (!itemDate) return true;
            const dateOnly = new Date(itemDate).toISOString().slice(0, 10);
            if (state.reportingStartDate && dateOnly < state.reportingStartDate) return false;
            if (state.reportingEndDate && dateOnly > state.reportingEndDate) return false;
            return true;
          });

          const revenueRows = filteredRows.filter(i => {
              const s = String(i.state || '').toLowerCase();
              return s === 'sale' || s === 'done';
          });
          const totalRevenue = revenueRows.reduce((sum, item) => sum + Number(item?.amount_total ?? item?.amount ?? 0), 0);
          
          renderRevenueReport({ total_revenue: totalRevenue, data: filteredRows });
          calculateAndRenderStats(filteredRows);
          showToast('Đã lọc báo cáo theo khoảng thời gian.', 'success');
        } catch (error) {
          console.error('Failed to filter reporting data:', error);
          showToast(error?.message || 'Không thể lọc dữ liệu báo cáo.', 'error');
        }
      });
    }
  }

  function bindManualDropdowns() {
    const customerSelect = document.getElementById('customerSelect');
    if (customerSelect) {
      customerSelect.addEventListener('focus', function () {
        if (this.dataset.loaded) return;
        this.dataset.loaded = 'true';

        setTimeout(() => {
          const options = buildCustomerOptions(state.customers);
          this.innerHTML = options;
          if (options) {
            this.value = this.querySelector('option')?.value || '';
          }
        }, 100);
      });
    }

    const productSelects = document.querySelectorAll('.line-product-select');
    productSelects.forEach((select) => {
      select.addEventListener('focus', function () {
        if (this.dataset.loaded) return;
        this.dataset.loaded = 'true';

        setTimeout(() => {
          const options = buildProductOptions(state.products);
          this.innerHTML = options;
          if (options) {
            this.value = this.querySelector('option')?.value || '';
          }
        }, 100);
      });
    });
  }

  function attachProductDropdownHandlers() {
    const productSelects = document.querySelectorAll('.line-product-select');
    productSelects.forEach((select) => {
      select.addEventListener('change', function () {
        const productId = Number(this.value || 0);
        const matchedProduct = state.products.find((item) => Number(item.id) === productId);
        const priceInput = this.closest('tr').querySelector('.line-price');
        if (priceInput) {
          priceInput.value = matchedProduct ? Number(matchedProduct.list_price || 0) : 0;
        }
        calculateSubtotalForRow(this.closest('tr'));
        updateTotals();
      });
    });
  }

  function initOrderTable() {
    const orderLinesBody = document.getElementById('orderLinesBody');
    if (orderLinesBody) {
      orderLinesBody.innerHTML = '';
      const row = createOrderRow(state.products);
      orderLinesBody.appendChild(row);
    }
  }

  async function refreshOrdersList() {
    try {
      const orders = await window.Api?.fetchOrders?.({
        search: state.search,
        status: state.status,
        sortBy: state.sortBy,
        order: state.order,
      });
      renderOrders(Array.isArray(orders) ? orders : []);
    } catch (error) {
      console.error('Failed to load orders', error);
      renderOrders([]);
      showToast(error?.message || 'Không thể tải đơn hàng.', 'error');
    }
  }

  function bindActions() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => window.Auth?.logout?.());
    }

    const tabOrders = document.getElementById('tab-orders');
    if (tabOrders) {
      tabOrders.addEventListener('click', () => switchView('orders'));
    }

    const tabProducts = document.getElementById('tab-products');
    if (tabProducts) {
      tabProducts.addEventListener('click', () => switchView('products'));
    }

    const tabReporting = document.getElementById('tab-reporting');
    if (tabReporting) {
      tabReporting.addEventListener('click', () => switchView('reporting'));
    }

    const btnReporting = document.getElementById('btn-reporting');
    if (btnReporting) {
      btnReporting.addEventListener('click', handleReporting);
    }

    const btnRevenue = document.getElementById('btn-revenue');
    if (btnRevenue) {
      btnRevenue.addEventListener('click', handleReporting);
    }

    const btnRevenueRefresh = document.getElementById('btn-revenue-refresh');
    if (btnRevenueRefresh) {
      btnRevenueRefresh.addEventListener('click', handleReporting);
    }

    const btnExport = document.getElementById('btn-export');
    if (btnExport) {
      btnExport.addEventListener('click', handleExport);
    }

    const btnSendQuote = document.getElementById('btn-send-quote');
    if (btnSendQuote) {
      const newSendBtn = btnSendQuote.cloneNode(true);
      btnSendQuote.parentNode.replaceChild(newSendBtn, btnSendQuote);
      
      newSendBtn.addEventListener('click', async () => {
        if (!state.selectedOrderId) return;
        
        const email = prompt("Nhập email khách hàng để gửi báo giá:");
        if (!email) return; 
        
        try {
          showToast('Đang gửi email, vui lòng đợi...', 'success');
          const response = await window.Api?.sendQuoteEmail?.(state.selectedOrderId, email);
          showToast(response?.message || 'Đã gửi email báo giá thành công.', 'success');
        } catch (error) {
          showToast(error?.message || 'Không thể gửi email.', 'error');
        }
      });
    }

    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', function() {
        const modal = this.closest('.modal-overlay');
        if (modal) modal.classList.add('hidden');
      });
    });
  
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    if (cancelModalBtn) {
      cancelModalBtn.addEventListener('click', () => {
        const orderModal = document.getElementById('orderModal');
        if (orderModal) orderModal.classList.add('hidden');
      });
    }

    const confirmOrderBtn = document.getElementById('confirmOrderBtn');
    if (confirmOrderBtn) {
      confirmOrderBtn.addEventListener('click', handleCreateOrderFromModal);
    }
    
    const btnExportInvoice = document.getElementById('btn-export-invoice');
    if (btnExportInvoice) {
      btnExportInvoice.addEventListener('click', async () => {
        if (!state.selectedOrderId) return;
        try {
          await window.Api?.exportInvoice?.(state.selectedOrderId);
          showToast('Xuất hóa đơn thành công.', 'success');
        } catch (error) {
          showToast(error?.message || 'Không thể xuất hóa đơn.', 'error');
        }
      });
    }

    const filterBtn = document.getElementById('btn-order-filters');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        const filterRow = document.querySelector('.toolbar-search-row');
        if (!filterRow) return;
        state.isFilterVisible = !state.isFilterVisible;
        filterRow.style.display = state.isFilterVisible ? 'flex' : 'none';
        showToast(state.isFilterVisible ? 'Hiển thị vùng lọc.' : 'Ẩn vùng lọc.', 'success');
      });
    }

    const newOrderBtn = document.getElementById('btn-new-order');
    if (newOrderBtn) {
      newOrderBtn.addEventListener('click', async () => {
        await openCreateOrderModal();
      });
    }

    const importOrderBtn = document.getElementById('btn-import-order');
    if (importOrderBtn) {
      importOrderBtn.addEventListener('click', () => {
        console.log('Import clicked');
        showToast('Import clicked', 'success');
      });
    }

    const newProductBtn = document.getElementById('btn-new-product');
    if (newProductBtn) {
      newProductBtn.addEventListener('click', () => {
        openProductModal();
        const productModal = document.getElementById('productModal');
        if (productModal) {
          productModal.classList.remove('hidden');
          showToast('Mở modal tạo sản phẩm.', 'success');
        }
      });
    }

    const saveProductBtn = document.getElementById('saveProductBtn');
    if (saveProductBtn) {
      saveProductBtn.addEventListener('click', async () => {
        const productNameInput = document.getElementById('productNameInput');
        const productPriceInput = document.getElementById('productPriceInput');
        if (!productNameInput || !productPriceInput) return;

        const payload = {
          name: productNameInput.value.trim(),
          list_price: Number(productPriceInput.value || 0),
        };

        try {
          let saved;
          if (state.editingProductId) {
            saved = await window.Api?.updateProduct?.(state.editingProductId, payload);
          } else {
            saved = await window.Api?.createProduct?.(payload);
          }

          const productModal = document.getElementById('productModal');
          if (productModal) {
            productModal.classList.add('hidden');
          }
          showToast(saved?.message || 'Lưu sản phẩm thành công.', 'success');
          const products = await window.Api?.fetchProducts?.();
          state.products = Array.isArray(products) ? products : [];
          renderProducts(state.products);
          resetProductModal();
        } catch (error) {
          showToast(error?.message || 'Không thể lưu sản phẩm.', 'error');
        }
      });
    }

    const cancelProductModalBtn = document.getElementById('cancelProductModalBtn');
    if (cancelProductModalBtn) {
      cancelProductModalBtn.addEventListener('click', () => {
        resetProductModal();
      });
    }

    const productDropdownTrigger = document.getElementById('productDropdownTrigger');
    const productDropdownMenu = document.getElementById('productDropdownMenu');
    if (productDropdownTrigger && productDropdownMenu) {
      productDropdownTrigger.addEventListener('click', (event) => {
        event?.preventDefault?.();
        const isOpen = productDropdownMenu.classList.contains('show');
        productDropdownMenu.classList.toggle('show', !isOpen);
        productDropdownMenu.classList.toggle('hidden', isOpen);
        productDropdownTrigger.setAttribute('aria-expanded', String(!isOpen));
      });
    }

    document.querySelectorAll('.dropdown-toggle').forEach((toggle) => {
      if (!toggle) return;
      toggle.addEventListener('click', (event) => {
        event?.preventDefault?.();
        const menu = toggle.nextElementSibling;
        if (!menu || !menu.classList) return;
        const isOpen = menu.classList.contains('show');
        menu.classList.toggle('show', !isOpen);
        menu.classList.toggle('hidden', isOpen);
        toggle.setAttribute('aria-expanded', String(!isOpen));
      });
    });

    bindManualDropdowns();
    attachProductDropdownHandlers();
    bindReportingDateFilters();

    const addLineBtn = document.getElementById('addLineBtn');
    if (addLineBtn) {
      const newAddBtn = addLineBtn.cloneNode(true);
      addLineBtn.parentNode.replaceChild(newAddBtn, addLineBtn);
      newAddBtn.addEventListener('click', () => {
        const tbody = document.getElementById('orderLinesBody');
        if (tbody) {
          tbody.appendChild(createOrderRow(state.products));
          updateTotals();
        }
      });
    }

    const confirmSaleBtn = document.getElementById('confirmSaleBtn');
    if (confirmSaleBtn) {
      const newConfirmBtn = confirmSaleBtn.cloneNode(true);
      confirmSaleBtn.parentNode.replaceChild(newConfirmBtn, confirmSaleBtn);
      newConfirmBtn.addEventListener('click', async () => {
        if (!state.selectedOrderId) return;
        try {
          await window.Api?.updateOrderStatus?.(state.selectedOrderId, { state: 'sale' });
          showToast('Xác nhận đơn hàng thành công.', 'success');
          document.getElementById('orderModal')?.classList.add('hidden');
          refreshOrdersList(); 
        } catch (error) {
          showToast(error?.message || 'Không thể xác nhận đơn hàng.', 'error');
        }
      });
    }

    const markDoneBtn = document.getElementById('markDoneBtn');
    if (markDoneBtn) {
      const newMarkBtn = markDoneBtn.cloneNode(true);
      markDoneBtn.parentNode.replaceChild(newMarkBtn, markDoneBtn);
      newMarkBtn.addEventListener('click', async () => {
        if (!state.selectedOrderId) return;
        try {
          await window.Api?.updateOrderStatus?.(state.selectedOrderId, { state: 'done' });
          showToast('Đã đánh dấu hoàn thành.', 'success');
          document.getElementById('orderModal')?.classList.add('hidden');
          refreshOrdersList();
          if (typeof loadReportingData === 'function') loadReportingData(); 
        } catch (error) {
          showToast(error?.message || 'Không thể hoàn thành đơn.', 'error');
        }
      });
    }
  
    const deleteOrderBtn = document.getElementById('deleteOrderBtn');
    if (deleteOrderBtn) {
      const newDeleteBtn = deleteOrderBtn.cloneNode(true);
      deleteOrderBtn.parentNode.replaceChild(newDeleteBtn, deleteOrderBtn);
      newDeleteBtn.addEventListener('click', async () => {
        if (!state.selectedOrderId) return;
        const confirmed = window.confirm('Bạn có chắc muốn xóa đơn hàng này không?');
        if (!confirmed) return;
        try {
          await window.Api?.deleteOrder?.(state.selectedOrderId);
          showToast('Đã xóa đơn hàng thành công.', 'success');
          document.getElementById('orderModal')?.classList.add('hidden');
          refreshOrdersList();
          if (typeof loadReportingData === 'function') loadReportingData();
        } catch (error) {
          showToast(error?.message || 'Không thể xóa đơn hàng.', 'error');
        }
      });
    }
    // --- MODULE HÓA ĐƠN ---
    const btnCreateInvoice = document.getElementById('btn-create-invoice');
    if (btnCreateInvoice) {
      const newBtn = btnCreateInvoice.cloneNode(true);
      btnCreateInvoice.parentNode.replaceChild(newBtn, btnCreateInvoice);
      newBtn.addEventListener('click', async () => {
        if (!state.selectedOrderId) return;
        try {
          const res = await window.Api?.createInvoice?.(state.selectedOrderId);
          showToast(res?.message || 'Tạo hóa đơn nháp thành công.', 'success');
          
          await refreshOrdersList();
          if (state.selectedOrderId) openOrderDetail(state.selectedOrderId);
        } catch (error) {
          showToast(error?.message || 'Không thể tạo hóa đơn.', 'error');
        }
      });
    }

    const btnConfirmInvoice = document.getElementById('btn-confirm-invoice');
    if (btnConfirmInvoice) {
      const newBtn = btnConfirmInvoice.cloneNode(true);
      btnConfirmInvoice.parentNode.replaceChild(newBtn, btnConfirmInvoice);
      newBtn.addEventListener('click', async () => {
        const invoiceId = state.currentInvoiceId; 
        if (!invoiceId) {
            showToast('Không tìm thấy mã hóa đơn trong phiên làm việc.', 'error');
            return;
        }
        try {
          const res = await window.Api?.confirmInvoice?.(invoiceId);
          showToast(res?.message || 'Xác nhận hóa đơn thành công.', 'success');
          
          if (state.selectedOrderId) openOrderDetail(state.selectedOrderId);
        } catch (error) {
          showToast(error?.message || 'Không thể xác nhận hóa đơn.', 'error');
        }
      });
    }

    const btnRegisterPayment = document.getElementById('btn-register-payment');
    if (btnRegisterPayment) {
      const newBtn = btnRegisterPayment.cloneNode(true);
      btnRegisterPayment.parentNode.replaceChild(newBtn, btnRegisterPayment);
      newBtn.addEventListener('click', async () => {
        const invoiceId = state.currentInvoiceId;
        if (!invoiceId) {
            showToast('Không tìm thấy mã hóa đơn.', 'error');
            return;
        }
        try {
          const res = await window.Api?.payInvoice?.(invoiceId);
          showToast(res?.message || 'Thanh toán hóa đơn thành công.', 'success');
          
          if (state.selectedOrderId) openOrderDetail(state.selectedOrderId);
          if (typeof loadReportingData === 'function') loadReportingData(); 
        } catch (error) {
          showToast(error?.message || 'Không thể thanh toán hóa đơn.', 'error');
        }
      });
    }

    const btnSendInvoice = document.getElementById('btn-send-invoice');
    if (btnSendInvoice) {
      const newSendInvBtn = btnSendInvoice.cloneNode(true);
      btnSendInvoice.parentNode.replaceChild(newSendInvBtn, btnSendInvoice);
      newSendInvBtn.addEventListener('click', async () => {
        const invoiceId = state.currentInvoiceId || state.selectedInvoiceId; 
        if (!invoiceId) {
           showToast('Không tìm thấy mã hóa đơn.', 'error');
           return;
        }
        const email = prompt("Nhập email khách hàng để gửi hóa đơn:");
        if (!email) return;
        
        try {
          showToast('Đang gửi email hóa đơn...', 'success');
          const res = await window.Api.sendInvoiceEmail(invoiceId);
          showToast(res.message || 'Gửi email thành công', 'success');
        } catch (error) {
          showToast(error.message || 'Lỗi gửi email', 'error');
        }
      });
    }

    const saveChangesBtn = document.getElementById('saveChangesBtn');
    if (saveChangesBtn) {
      const newSaveBtn = saveChangesBtn.cloneNode(true);
      saveChangesBtn.parentNode.replaceChild(newSaveBtn, saveChangesBtn);
      newSaveBtn.addEventListener('click', async () => {
        if (!state.selectedOrderId) return;
        try {
          const customerSelect = document.getElementById('customerSelect');
          const customerInputValue = customerSelect ? String(customerSelect.value).trim() : '';
          const customerPhoneEl = document.getElementById('customerPhone');
          const partnerPhone = customerPhoneEl ? String(customerPhoneEl.value).trim() : '';

          const matchedCustomer = state.customers.find(c => c.name === customerInputValue || String(c.id) === customerInputValue);
          const partnerId = matchedCustomer ? Number(matchedCustomer.id) : 0;
          const partnerName = matchedCustomer ? '' : customerInputValue;
          const lines = getOrderLinesFromTable();

          if (!lines.length) {
            showToast('Đơn hàng cần ít nhất 1 sản phẩm.', 'error');
            return;
          }

          const payload = {
            partner_id: partnerId,
            partner_name: partnerName,
            partner_phone: partnerPhone,
            lines: lines,
          };

          await window.Api.updateOrder(state.selectedOrderId, payload);
          showToast('Cập nhật thay đổi thành công.', 'success');
          refreshOrdersList();
          openOrderDetail(state.selectedOrderId);
        } catch (error) {
          showToast(error?.message || 'Không thể lưu thay đổi.', 'error');
        }
      });
    }
  }

  async function init() {
    if (!window.Auth?.requireAuth?.()) return;

    try {
      window.Auth.hydrateUserText?.();
      state.role = window.Auth.getRole?.() || 'Manager';
      applyUIByRole(state.role);
      bindActions();
      bindOrderFilters();
      await loadCustomersAndProductsIntoOrderModal();
      const products = await window.Api?.fetchProducts?.();
      state.products = Array.isArray(products) ? products : [];
      renderProducts(state.products);

      const filterRow = document.querySelector('.toolbar-search-row');
      if (filterRow) {
        filterRow.style.display = state.isFilterVisible ? 'flex' : 'none';
      }

      const orders = await window.Api?.fetchOrders?.({
        search: state.search,
        status: state.status,
        sortBy: state.sortBy,
        order: state.order,
      });
      renderOrders(Array.isArray(orders) ? orders : []);

      await hydrateRevenueStats();
      if (state.role === 'Manager') {
        await loadReportingData();
      }
    } catch (error) {
      console.error('Failed to initialize orders', error);
      renderOrders([]);
      showToast(error?.message || 'Không thể tải dữ liệu ban đầu.', 'error');
    }
  }

  function renderRevenueReport(report = {}) {
    try {
      const rows = Array.isArray(report?.data) ? report.data : (Array.isArray(report) ? report : []);
      const totalValue = Number(report.total_revenue ?? rows.reduce((sum, item) => sum + Number(item.amount_total || 0), 0));
      
      const body = document.getElementById('reportingBody');
      const totalEl = document.getElementById('reportingTotalRevenue');
      const statTotalRevenue = document.getElementById('statTotalRevenue');

      if (totalEl) totalEl.textContent = formatMoney(totalValue);
      if (statTotalRevenue) statTotalRevenue.textContent = formatMoney(totalValue);

      if (!body) return;

      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty-row text-center p-4">Không có dữ liệu doanh thu trong thời gian này.</td></tr>';
        return;
      }

      body.innerHTML = rows
        .map((item) => {
          const stateValue = String(item.state || 'draft').toLowerCase();
          const statusLabel = ORDER_STATE_LABELS[stateValue] || 'Draft';
          const statusClass = getStatusBadgeClass(stateValue);
          
          return `
          <tr>
            <td><strong>${item.order_name || `#${item.id}`}</strong></td>
            <td>${item.customer_name || 'Khách lẻ'}</td>
            <td>${formatDate(item.date_order)}</td>
            <td><span class="badge ${statusClass}">${statusLabel}</span></td>
            <td class="text-end" style="font-weight: 600; color: #206bc4;">${formatMoney(item.amount_total)}</td>
          </tr>
        `})
        .join('');
    } catch (error) {
      console.error('renderRevenueReport failed:', error);
      const body = document.getElementById('reportingBody');
      if (body) {
        body.innerHTML = '<tr><td colspan="5" class="empty-row text-center p-4">Không có dữ liệu doanh thu.</td></tr>';
      }
      const totalEl = document.getElementById('reportingTotalRevenue');
      if (totalEl) totalEl.textContent = '0 đ';
    }
  }

  try {
    window.UI = {
      init,
      applyUIByRole,
      switchView,
      showToast,
      refreshOrdersList,
      renderRevenueReport,
    };
  } catch (err) {
    console.error('UI registration failed:', err);
  }
})();

window.addEventListener('DOMContentLoaded', () => {
  try {
    if (window.Auth && window.Api && window.UI) {
      window.UI.init();
    }
  } catch (error) {
    console.error('Dashboard initialization failed:', error);
    const fallbackToast = document.getElementById('toastContainer');
    if (fallbackToast) {
      const toast = document.createElement('div');
      toast.className = 'toast toast-error';
      toast.textContent = 'Không thể khởi tạo giao diện.';
      fallbackToast.appendChild(toast);
      setTimeout(() => toast.remove(), 2200);
    }
  }
});