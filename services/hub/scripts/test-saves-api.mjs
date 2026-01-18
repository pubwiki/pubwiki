#!/usr/bin/env node
/**
 * Cloud Saves API 测试脚本
 * 
 * 用法: node test-saves-api.mjs
 */

const API_BASE = process.env.API_BASE || 'http://localhost:8789';

// 颜色输出
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

async function request(method, path, body, cookies = '') {
  const url = `${API_BASE}${path}`;
  console.log(colors.cyan(`\n→ ${method} ${path}`));
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
    },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
    console.log('  Body:', JSON.stringify(body, null, 2).split('\n').slice(0, 5).join('\n'));
  }
  
  try {
    const res = await fetch(url, options);
    const setCookie = res.headers.get('set-cookie');
    
    let data;
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    
    const status = res.status;
    const statusColor = status < 400 ? colors.green : colors.red;
    console.log(`  Status: ${statusColor(status)}`);
    console.log('  Response:', JSON.stringify(data, null, 2).split('\n').slice(0, 10).join('\n'));
    
    return { status, data, setCookie };
  } catch (error) {
    console.log(colors.red(`  Error: ${error.message}`));
    return { status: 0, data: null, error };
  }
}

async function main() {
  console.log(colors.yellow('='.repeat(60)));
  console.log(colors.yellow('Cloud Saves API 测试'));
  console.log(colors.yellow('='.repeat(60)));
  
  // 1. 测试未认证访问
  console.log(colors.yellow('\n[1] 测试未认证访问 /api/saves'));
  const unauth = await request('GET', '/api/saves');
  if (unauth.status === 401) {
    console.log(colors.green('✓ 正确返回 401 未认证'));
  } else {
    console.log(colors.red(`✗ 期望 401，实际 ${unauth.status}`));
  }
  
  // 2. 注册新用户
  console.log(colors.yellow('\n[2] 注册测试用户'));
  const testUser = {
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
    name: 'Test User',
    username: `testuser${Date.now()}`,
  };
  const signUp = await request('POST', '/api/auth/sign-up/email', testUser);
  const sessionCookie = signUp.setCookie?.split(';')[0] || '';
  
  if (!sessionCookie) {
    console.log(colors.red('✗ 注册失败，无法获取 session cookie'));
    console.log('  尝试登录已存在的用户...');
    
    // 尝试登录
    const signIn = await request('POST', '/api/auth/sign-in/email', {
      email: 'test@example.com',
      password: 'testpassword123',
    });
    
    if (!signIn.setCookie) {
      console.log(colors.red('✗ 登录也失败，跳过后续测试'));
      return;
    }
  }
  
  const cookies = sessionCookie || signUp.setCookie?.split(';')[0] || '';
  console.log(colors.green(`✓ 已认证: ${cookies.substring(0, 50)}...`));
  
  // 3. 创建存档
  console.log(colors.yellow('\n[3] 创建新存档'));
  const createSave = await request('POST', '/api/saves', {
    name: 'Test Save',
    description: 'A test cloud save',
  }, cookies);
  
  if (createSave.status !== 201) {
    console.log(colors.red('✗ 创建存档失败'));
    return;
  }
  
  const saveId = createSave.data.id;
  console.log(colors.green(`✓ 存档已创建: ${saveId}`));
  
  // 4. 获取存档列表
  console.log(colors.yellow('\n[4] 获取存档列表'));
  const listSaves = await request('GET', '/api/saves', null, cookies);
  if (listSaves.status === 200 && Array.isArray(listSaves.data.saves)) {
    console.log(colors.green(`✓ 存档列表: ${listSaves.data.saves.length} 个存档`));
  }
  
  // 5. 获取存档详情
  console.log(colors.yellow('\n[5] 获取存档详情'));
  const getSave = await request('GET', `/api/saves/${saveId}`, null, cookies);
  if (getSave.status === 200) {
    console.log(colors.green(`✓ quadCount: ${getSave.data.quadCount}, versionCount: ${getSave.data.versionCount}`));
  }
  
  // 6. 执行操作 - 插入 quad
  console.log(colors.yellow('\n[6] 插入 RDF quad'));
  const insertOp = await request('POST', `/api/saves/${saveId}/operations`, {
    operations: [
      {
        type: 'insert',
        quad: {
          subject: '<http://example.org/subject1>',
          predicate: '<http://example.org/predicate1>',
          object: 'Hello World',
          graph: '',
        },
      },
      {
        type: 'insert',
        quad: {
          subject: '<http://example.org/subject2>',
          predicate: '<http://example.org/name>',
          object: 'Test Name',
          objectLanguage: 'en',
          graph: '',
        },
      },
    ],
  }, cookies);
  
  if (insertOp.status === 200 && insertOp.data.success) {
    console.log(colors.green(`✓ 操作成功，新 ref: ${insertOp.data.ref}`));
  }
  
  // 7. 查询 quads
  console.log(colors.yellow('\n[7] 查询 quads'));
  const queryQuads = await request('POST', `/api/saves/${saveId}/query`, {
    subject: '<http://example.org/subject1>',
  }, cookies);
  
  if (queryQuads.status === 200) {
    console.log(colors.green(`✓ 查询到 ${queryQuads.data.quads?.length || 0} 个 quad`));
  }
  
  // 8. 导出数据
  console.log(colors.yellow('\n[8] 导出存档数据'));
  const exportSave = await request('GET', `/api/saves/${saveId}/sync`, null, cookies);
  if (exportSave.status === 200) {
    console.log(colors.green(`✓ 导出 ${exportSave.data.quadCount} 个 quad, ref: ${exportSave.data.ref}`));
  }
  
  // 9. 版本历史
  console.log(colors.yellow('\n[9] 获取版本历史'));
  const history = await request('GET', `/api/saves/${saveId}/history?limit=10`, null, cookies);
  if (history.status === 200) {
    console.log(colors.green(`✓ ${history.data.versions?.length || 0} 个版本，当前 ref: ${history.data.currentRef}`));
  }
  
  // 10. 删除存档
  console.log(colors.yellow('\n[10] 删除存档'));
  const deleteSave = await request('DELETE', `/api/saves/${saveId}`, null, cookies);
  if (deleteSave.status === 204) {
    console.log(colors.green('✓ 存档已删除'));
  }
  
  console.log(colors.yellow('\n' + '='.repeat(60)));
  console.log(colors.green('测试完成!'));
  console.log(colors.yellow('='.repeat(60)));
}

main().catch(console.error);
