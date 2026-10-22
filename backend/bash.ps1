 $Base = "http://127.0.0.1:3000/api/v1"
  $Headers = @{"Content-Type" = "application/json"; "Origin" = "http://localhost:3000"}

  # 1. Get nonce
  $nonceResp = Invoke-RestMethod -Method Post -Uri "$Base/auth/bootstrap" -Headers $Headers -Body '{}' -SessionVariable sess
  Write-Host "Nonce response: $($nonceResp | ConvertTo-Json -Depth 3)"

  # 2. List posts (public, no auth)
  $posts = Invoke-RestMethod -Method Get -Uri "$Base/posts?limit=10&offset=0" -WebSession $sess
  Write-Host "Posts: $($posts | ConvertTo-Json -Depth 3)"

  # 3. Get one post by slug
  $post = Invoke-RestMethod -Method Get -Uri "$Base/posts/hello-world" -WebSession $sess
  Write-Host "Single post: $($post | ConvertTo-Json -Depth 3)"

  # 4. Create post (requires session from Google sign-in)
  $created = Invoke-RestMethod -Method Post -Uri "$Base/posts" -Headers $Headers -Body '{"slug":"hello-world","title":"Hello World","description":"First
  post","status":"published"}' -WebSession $sess
  Write-Host "Created: $($created | ConvertTo-Json -Depth 3)"

  # 5. Update post
  $updated = Invoke-RestMethod -Method Patch -Uri "$Base/posts/hello-world" -Headers $Headers -Body '{"title":"Updated Title"}' -WebSession $sess
  Write-Host "Updated: $($updated | ConvertTo-Json -Depth 3)"

  # 6. Delete post
  Invoke-RestMethod -Method Delete -Uri "$Base/posts/hello-world" -Headers $Headers -WebSession $sess
  Write-Host "Deleted successfully"