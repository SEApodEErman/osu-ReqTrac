const http = require('http');

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

// Helper to make HTTP requests in Node
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    const options = {
      method,
      headers: {
        'Accept': 'application/json'
      }
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== Starting API Automation Tests ===\n');
  let testRequestId = null;

  try {
    // Test 1: Health Check
    console.log('Test 1: Health Check...');
    const health = await makeRequest('GET', '/api/health');
    if (health.status === 200 && health.data.status === 'ok') {
      console.log('✓ Health check passed.\n');
    } else {
      throw new Error(`Health check failed: ${JSON.stringify(health)}`);
    }

    // Test 2: Create Request (Manual Entry)
    console.log('Test 2: Creating a Manual Request...');
    const newRequest = {
      artist: 'LeaF',
      title: 'Aleph-0',
      creator: 'ProfessionalMapper',
      difficulty: 'Extra',
      notes: 'Test manual entry notes',
      categories: [
        { name: 'Hitsounds', status: 'Pending' },
        { name: 'Others', other_text: 'Keysounds', status: 'Working' }
      ],
      priority: 'High',
      deadline: '2026-08-15',
      requester_username: 'TestUser',
      tags: ['test', 'fast', 'keysounds']
    };

    const createRes = await makeRequest('POST', '/api/requests', newRequest);
    if (createRes.status === 201 && createRes.data.success) {
      testRequestId = createRes.data.requestId;
      console.log(`✓ Request created successfully with ID: ${testRequestId}\n`);
    } else {
      throw new Error(`Failed to create request: ${JSON.stringify(createRes)}`);
    }

    // Test 3: List Requests and Verify
    console.log('Test 3: Fetching Requests List...');
    const listRes = await makeRequest('GET', '/api/requests');
    if (listRes.status === 200 && Array.isArray(listRes.data)) {
      const createdItem = listRes.data.find(r => r.id === testRequestId);
      if (createdItem && createdItem.title === 'Aleph-0' && createdItem.categories.length === 2) {
        console.log('✓ Found created request in list with correct details.');
        console.log(`  Artist: ${createdItem.artist}`);
        console.log(`  Categories: ${createdItem.categories.map(c => c.category_name).join(', ')}`);
        console.log(`  Tags: ${createdItem.tags.join(', ')}\n`);
      } else {
        throw new Error('Created request not found or has incorrect details in list.');
      }
    } else {
      throw new Error('Failed to retrieve requests list.');
    }

    // Test 4: Update Request
    console.log('Test 4: Updating Request Status and Priorities...');
    const updateRes = await makeRequest('PATCH', `/api/requests/${testRequestId}`, {
      request_status: 'Working',
      priority: 'Low',
      categories: [
        { category_name: 'Hitsounds', status: 'Working' },
        { category_name: 'Others', other_text: 'Keysounds', status: 'Completed' }
      ]
    });
    if (updateRes.status === 200 && updateRes.data.success) {
      console.log('✓ Request updated successfully.');
      
      // Verify update
      const verifyRes = await makeRequest('GET', '/api/requests');
      const updatedItem = verifyRes.data.find(r => r.id === testRequestId);
      if (updatedItem.request_status === 'Working' && updatedItem.priority === 'Low') {
        const hsCat = updatedItem.categories.find(c => c.category_name === 'Hitsounds');
        const otherCat = updatedItem.categories.find(c => c.category_name === 'Others');
        if (hsCat.status === 'Working' && otherCat.status === 'Completed') {
          console.log('✓ Updated details verified in database.\n');
        } else {
          throw new Error('Category progress status did not update correctly.');
        }
      } else {
        throw new Error('Overall status or priority did not update correctly.');
      }
    } else {
      throw new Error('Failed to update request.');
    }

    // Test 5: Fetch Statistics
    console.log('Test 5: Fetching Dashboard Statistics...');
    const statsRes = await makeRequest('GET', '/api/stats');
    if (statsRes.status === 200 && statsRes.data.overview) {
      console.log('✓ Statistics retrieved.');
      console.log(`  Total: ${statsRes.data.overview.total}`);
      console.log(`  Active: ${statsRes.data.overview.active}`);
      console.log(`  Completed: ${statsRes.data.overview.completed}\n`);
    } else {
      throw new Error('Failed to fetch statistics.');
    }

    // Test 6: Export Backup
    console.log('Test 6: Testing JSON Database Export...');
    const exportRes = await makeRequest('GET', '/api/migration/export');
    if (exportRes.status === 200 && exportRes.data.requests) {
      console.log('✓ JSON export successfully retrieved backup data.');
      console.log(`  Backup version: ${exportRes.data.version}`);
      console.log(`  Exported requests count: ${exportRes.data.requests.length}\n`);
    } else {
      throw new Error('Failed to export database backup.');
    }

    // Test 7: Delete Request
    console.log('Test 7: Deleting the Test Request...');
    const deleteRes = await makeRequest('DELETE', `/api/requests/${testRequestId}`);
    if (deleteRes.status === 200 && deleteRes.data.success) {
      console.log('✓ Request deleted successfully.');
      
      const verifyDel = await makeRequest('GET', '/api/requests');
      const deletedItem = verifyDel.data.find(r => r.id === testRequestId);
      if (!deletedItem) {
        console.log('✓ Verification passed: request no longer exists in database.\n');
      } else {
        throw new Error('Request was not removed from database.');
      }
    } else {
      throw new Error('Failed to delete request.');
    }

    console.log('=== All Backend API Tests Passed Successfully! ===');
  } catch (error) {
    console.error('❌ Test execution failed:', error.message);
    process.exit(1);
  }
}

// Small delay to ensure database finishes initializing
setTimeout(runTests, 1000);
