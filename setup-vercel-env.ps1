# Vercel Environment Variables Setup Script
# Run this after linking your project with: vercel link

Write-Host "`n🔧 Vercel Environment Variables Setup" -ForegroundColor Cyan
Write-Host "====================================`n"

# Check if vercel is linked
if (-not (Test-Path ".vercel/project.json")) {
    Write-Host "⚠️  Project not linked. Running 'vercel link'..." -ForegroundColor Yellow
    vercel link
}

# Function to add env var
function Add-VercelEnv {
    param($name, $description, $required = $true)
    
    Write-Host "`n📝 $name" -ForegroundColor Green
    Write-Host "   $description" -ForegroundColor Gray
    
    if ($required) {
        $value = Read-Host "   Enter value (required)"
        if ([string]::IsNullOrWhiteSpace($value)) {
            Write-Host "   ❌ Skipped (empty)" -ForegroundColor Red
            return
        }
    } else {
        $value = Read-Host "   Enter value (optional, press Enter to skip)"
        if ([string]::IsNullOrWhiteSpace($value)) {
            Write-Host "   ⏭️  Skipped" -ForegroundColor Yellow
            return
        }
    }
    
    # Add to all environments
    $value | vercel env add $name production
    $value | vercel env add $name preview
    $value | vercel env add $name development
    
    Write-Host "   ✅ Added to all environments" -ForegroundColor Green
}

Write-Host "`n=== REQUIRED API KEYS ===" -ForegroundColor Yellow

Add-VercelEnv "GEMINI_API_KEY" "Google AI API key (from aistudio.google.com/apikey)"
Add-VercelEnv "REPLICATE_API_TOKEN" "Replicate API token (from replicate.com/account/api-tokens)"

Write-Host "`n=== FIREBASE (for cloud save) ===" -ForegroundColor Yellow

Add-VercelEnv "FIREBASE_PROJECT_ID" "Your Firebase project ID" $false
Add-VercelEnv "FIREBASE_CLIENT_EMAIL" "Service account email (ends with @...iam.gserviceaccount.com)" $false
Add-VercelEnv "FIREBASE_PRIVATE_KEY" "Service account private key (include BEGIN/END lines)" $false
Add-VercelEnv "FIREBASE_STORAGE_BUCKET" "Storage bucket (e.g., yourproject.appspot.com)" $false

Write-Host "`n`n✅ Environment variables configured!" -ForegroundColor Green
Write-Host "🚀 Now redeploy with: vercel --prod`n" -ForegroundColor Cyan
