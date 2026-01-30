---
title: API Reference
description: Pub.Wiki API documentation
order: 4
---

# API Reference

Pub.Wiki provides a REST API for programmatic access to the platform.

## Base URL

```
https://api.pub.wiki/v1
```

## Authentication

All API requests require authentication using Bearer tokens:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.pub.wiki/v1/artifacts
```

## Endpoints

### Artifacts

#### List Artifacts

```http
GET /artifacts
```

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| page | number | Page number |
| limit | number | Items per page |
| tag | string | Filter by tag |

#### Get Artifact

```http
GET /artifacts/:id
```

#### Create Artifact

```http
POST /artifacts
```

Request body:

```json
{
  "name": "My Adventure",
  "description": "An exciting journey",
  "content": { ... }
}
```

### Users

#### Get Current User

```http
GET /users/me
```

#### Get User Profile

```http
GET /users/:username
```

### Game Saves

#### List Saves

```http
GET /saves
```

#### Create Save

```http
POST /saves
```

## Rate Limits

- 100 requests per minute for authenticated users
- 10 requests per minute for unauthenticated users

## Error Handling

All errors return JSON with the following structure:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Artifact not found"
  }
}
```

## SDKs

- [JavaScript SDK](https://github.com/pubwiki/sdk-js)
- [Python SDK](https://github.com/pubwiki/sdk-python)
