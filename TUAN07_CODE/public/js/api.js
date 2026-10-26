(function () {
  function getAuthHeaders(extraHeaders = {}) {
    const token = window.Auth?.getToken?.() || '';
    return {
      ...extraHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function fetchCustomers() {
    try {
      const response = await fetch('/api/customers', {
        headers: getAuthHeaders(),
      });

      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể tải danh sách khách hàng.');
      }

      return Array.isArray(payload) ? payload : payload.data || [];
    } catch (error) {
      console.error('fetchCustomers failed:', error);
      throw error;
    }
  }

  async function fetchProducts() {
    try {
      const response = await fetch('/api/products', {
        headers: getAuthHeaders(),
      });

      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể tải danh sách sản phẩm.');
      }

      return Array.isArray(payload) ? payload : payload.data || [];
    } catch (error) {
      console.error('fetchProducts failed:', error);
      throw error;
    }
  }

  async function updateProduct(productId, productPayload = {}) {
    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(productPayload),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể cập nhật sản phẩm.');
      }

      return payload;
    } catch (error) {
      console.error('updateProduct failed:', error);
      throw error;
    }
  }

  async function deleteProduct(productId) {
    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể xóa sản phẩm.');
      }

      return payload;
    } catch (error) {
      console.error('deleteProduct failed:', error);
      throw error;
    }
  }

  async function fetchOrders(params = {}) {
    try {
      const query = new URLSearchParams({
        search: params.search || '',
        status: params.status || 'all',
        sortBy: params.sortBy || 'date_order',
        order: params.order || 'desc',
      });

      const response = await fetch(`/api/orders?${query.toString()}`, {
        headers: getAuthHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể tải danh sách đơn hàng.');
      }

      return Array.isArray(payload) ? payload : payload.data || [];
    } catch (error) {
      console.error('fetchOrders failed:', error);
      throw error;
    }
  }

  async function createProduct(productPayload = {}) {
    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(productPayload),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể tạo sản phẩm.');
      }

      return payload;
    } catch (error) {
      console.error('createProduct failed:', error);
      throw error;
    }
  }

  async function createOrder(orderPayload = {}) {
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(orderPayload),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể tạo đơn hàng.');
      }

      return payload;
    } catch (error) {
      console.error('createOrder failed:', error);
      throw error;
    }
  }

  async function updateOrder(orderId, orderPayload = {}) {
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(orderPayload),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể cập nhật đơn hàng.');
      }

      return payload;
    } catch (error) {
      console.error('updateOrder failed:', error);
      throw error;
    }
  } 

  async function updateOrderStatus(orderId, statusPayload = {}) {
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(statusPayload),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể cập nhật trạng thái đơn hàng.');
      }

      return payload;
    } catch (error) {
      console.error('updateOrderStatus failed:', error);
      throw error;
    }
  }

  async function fetchRevenueReport() {
    try {
      const response = await fetch('/api/reports/revenue', {
        headers: getAuthHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể tải báo cáo doanh thu.');
      }

      return payload;
    } catch (error) {
      console.error('fetchRevenueReport failed:', error);
      throw error;
    }
  }

  async function exportInvoice(orderId) {
    try {
      const response = await fetch(`/api/orders/${orderId}/invoice/export`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Không thể xuất hóa đơn PDF.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${orderId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      return { ok: true, orderId };
    } catch (error) {
      console.error('exportInvoice failed:', error);
      throw error;
    }
  }

  async function sendQuoteEmail(orderId, email = '') {
    try {
      const response = await fetch('/api/send-quote-email', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ orderId, email }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Không thể gửi báo giá.');
      }

      return response.json();
    } catch (error) {
      console.error('sendQuoteEmail failed:', error);
      throw error;
    }
  }

  async function fetchOrderDetails(orderId) {
    try {
      const response = await fetch(`/api/orders/${orderId}/details`, {
        headers: getAuthHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể tải chi tiết đơn hàng.');
      }

      return payload;
    } catch (error) {
      console.error('fetchOrderDetails failed:', error);
      throw error;
    }
  }

  async function fetchRevenueData(startDate = '', endDate = '') {
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(`/api/reports/revenue${query}`, {
        headers: getAuthHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể tải dữ liệu doanh thu.');
      }

      if (payload && Array.isArray(payload.data)) {
        return payload;
      }

      if (Array.isArray(payload)) {
        return { total_revenue: payload.reduce((sum, item) => sum + Number(item?.amount_total ?? item?.total_revenue ?? 0), 0), data: payload };
      }

      return { total_revenue: 0, data: [] };
    } catch (error) {
      console.error('fetchRevenueData failed:', error);
      throw error;
    }
  }

  async function deleteOrder(orderId) {
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Không thể xóa đơn hàng.');
      }
      return payload;
    } catch (error) {
      console.error('deleteOrder failed:', error);
      throw error;
    }
  }

async function createInvoice(orderId) {
    try {
      const response = await fetch(`/api/orders/${orderId}/create-invoice`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Không thể tạo hóa đơn.');
      return payload;
    } catch (error) {
      console.error('createInvoice failed:', error);
      throw error;
    }
  }

  async function confirmInvoice(invoiceId) {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/confirm`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Không thể xác nhận hóa đơn.');
      return payload;
    } catch (error) {
      console.error('confirmInvoice failed:', error);
      throw error;
    }
  }

  async function payInvoice(invoiceId) {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/payment`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Không thể thanh toán hóa đơn.');
      return payload;
    } catch (error) {
      console.error('payInvoice failed:', error);
      throw error;
    }
  } 

  async function sendInvoiceEmail(invoiceId) {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/send-email`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Không thể gửi email hóa đơn.');
      return payload;
    } catch (error) {
      console.error('sendInvoiceEmail failed:', error);
      throw error;
    }
  } 

  window.Api = {
    fetchCustomers,
    fetchProducts,
    updateProduct,
    deleteProduct,
    fetchOrders,
    createProduct,
    createOrder,
    updateOrder,
    updateOrderStatus,
    fetchRevenueReport,
    fetchRevenueData,
    exportInvoice,
    sendQuoteEmail,
    fetchOrderDetails,
    createInvoice,
    confirmInvoice,
    payInvoice,
    sendInvoiceEmail,
    deleteOrder,
  };
})();