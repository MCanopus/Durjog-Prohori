const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const router = express.Router();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI('AIzaSyBcS04tg5wxR6b1cglnYSTRg50eTU1KzqA');

// Disaster management system prompt for Bangladesh
const SYSTEM_PROMPT = `You are DPAI (Durjog Prohori AI), a specialized AI assistant for disaster management in Bangladesh. You have extensive knowledge about:

1. Bangladesh's geography, climate, and disaster patterns
2. Common disasters: floods, cyclones, earthquakes, landslides, droughts
3. Emergency response procedures and evacuation protocols
4. Safe routes and shelter locations across Bangladesh
5. Real-time disaster preparedness and response strategies

Your primary functions:
- Provide immediate emergency guidance
- Suggest safe evacuation routes based on location
- Offer disaster preparedness advice
- Assess local disaster risks
- Give location-specific safety recommendations

Guidelines:
- Always prioritize user safety
- Provide clear, actionable advice
- Use simple, understandable language
- Include specific Bangladesh context
- Suggest contacting local emergency services when appropriate
- Be empathetic and reassuring during emergencies
- When asked about your name or what DPAI stands for, always respond that DPAI stands for "Durjog Prohori AI" - the AI assistant for the Durjog Prohori disaster management system

For evacuation routes, consider:
- Major highways and roads in Bangladesh
- Safe zones and shelters
- Avoid flood-prone areas during monsoons
- Consider cyclone shelters in coastal areas
- Account for traffic patterns and road conditions

Emergency contacts to mention when relevant:
- National Emergency Service: 999
- Fire Service: 9555555
- Police: 100
- Ambulance: 199`;

// Bangladesh disaster knowledge base
const BANGLADESH_DISASTER_INFO = {
  floods: {
    riskAreas: ['Sylhet', 'Rangpur', 'Kurigram', 'Gaibandha', 'Sirajganj'],
    season: 'June to September (Monsoon)',
    safetyTips: [
      'Move to higher ground immediately',
      'Avoid walking through flood water',
      'Keep emergency supplies ready',
      'Stay informed through radio/mobile alerts'
    ]
  },
  cyclones: {
    riskAreas: ['Cox\'s Bazar', 'Chittagong', 'Barisal', 'Patuakhali', 'Bhola'],
    season: 'April to December (Peak: May-June, October-November)',
    safetyTips: [
      'Move to designated cyclone shelters',
      'Secure loose objects around your home',
      'Stock up on food, water, and medicines',
      'Follow evacuation orders immediately'
    ]
  },
  earthquakes: {
    riskAreas: ['Dhaka', 'Chittagong', 'Sylhet', 'Rangpur'],
    safetyTips: [
      'Drop, Cover, and Hold On during shaking',
      'Stay away from windows and heavy objects',
      'If outdoors, move away from buildings',
      'After shaking stops, evacuate if building is damaged'
    ]
  }
};

// Store conversation history (in production, use a proper database)
const conversationHistory = new Map();

// Test endpoint to verify Gemini AI connection
router.get('/test', async (req, res) => {
  try {
    console.log('Testing Gemini AI connection...');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const result = await model.generateContent('Hello, please respond with "DPAI connection successful"');
    const response = await result.response;
    const text = response.text();
    
    res.json({
      success: true,
      message: 'Gemini AI connection successful',
      response: text,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Gemini AI Test Error:', error);
    res.json({
      success: false,
      message: 'Gemini AI connection failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Simple debug endpoint that returns a known response
router.post('/debug', (req, res) => {
  const { message } = req.body;
  console.log('Debug endpoint called with message:', message);
  
  res.json({
    success: true,
    response: `Debug response: You said "${message}". This is a test response to verify the message display is working correctly.`,
    suggestions: ['Test suggestion 1', 'Test suggestion 2'],
    timestamp: new Date().toISOString(),
    debug: true
  });
});

router.post('/chat', async (req, res) => {
  try {
    const { message, location, conversationHistory: clientHistory } = req.body;

    console.log('DPAI Chat Request:', { message, location, historyLength: clientHistory?.length });

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Test API key validity first
    if (!process.env.GEMINI_API_KEY && !genAI) {
      console.log('No Gemini API key found, using fallback');
      throw new Error('API key not configured');
    }

    // Get the generative model (updated model name)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Build context with location and conversation history
    let contextualPrompt = SYSTEM_PROMPT;
    
    if (location) {
      contextualPrompt += `\n\nUser's current location: Latitude ${location.latitude}, Longitude ${location.longitude}`;
      contextualPrompt += `\nPlease provide location-specific advice for Bangladesh.`;
    }

    if (clientHistory && clientHistory.length > 0) {
      contextualPrompt += `\n\nConversation history:\n`;
      clientHistory.forEach(msg => {
        contextualPrompt += `${msg.type === 'user' ? 'User' : 'DPAI'}: ${msg.content}\n`;
      });
    }

    contextualPrompt += `\n\nUser's current message: ${message}`;

    console.log('Sending request to Gemini AI...');

    // Generate response with timeout
    const result = await Promise.race([
      model.generateContent(contextualPrompt),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 30000)
      )
    ]);

    const response = await result.response;
    const aiResponse = response.text();

    console.log('Gemini AI response received successfully');
    console.log('Raw AI Response:', JSON.stringify(aiResponse, null, 2));
    console.log('AI Response length:', aiResponse.length);
    console.log('AI Response type:', typeof aiResponse);

    // Generate follow-up suggestions based on the conversation
    const suggestions = generateSuggestions(message, aiResponse);

    // Ensure we're sending clean data
    const cleanResponse = {
      success: true,
      response: String(aiResponse).trim(),
      suggestions: suggestions || [],
      timestamp: new Date().toISOString(),
      debug: {
        responseLength: aiResponse.length,
        responseType: typeof aiResponse,
        hasContent: !!aiResponse
      }
    };

    console.log('Sending response:', JSON.stringify(cleanResponse, null, 2));
    res.json(cleanResponse);

  } catch (error) {
    console.error('DPAI Chat Error Details:', {
      message: error.message,
      stack: error.stack,
      userMessage: req.body.message
    });
    
    // Provide fallback response for common queries
    const fallbackResponse = generateFallbackResponse(req.body.message);
    
    res.json({
      success: true,
      response: fallbackResponse,
      suggestions: [
        'What should I do in case of flooding?',
        'Show me evacuation routes',
        'Emergency contact numbers'
      ],
      timestamp: new Date().toISOString(),
      fallback: true
    });
  }
});

// Generate contextual suggestions
function generateSuggestions(userMessage, aiResponse) {
  const suggestions = [];
  const lowerMessage = userMessage.toLowerCase();

  if (lowerMessage.includes('flood')) {
    suggestions.push('What are the flood-prone areas in Bangladesh?');
    suggestions.push('How to prepare for monsoon floods?');
  } else if (lowerMessage.includes('cyclone')) {
    suggestions.push('Where are the nearest cyclone shelters?');
    suggestions.push('Cyclone preparedness checklist');
  } else if (lowerMessage.includes('earthquake')) {
    suggestions.push('Earthquake safety during and after shaking');
    suggestions.push('Building safety assessment after earthquake');
  } else if (lowerMessage.includes('route') || lowerMessage.includes('evacuation')) {
    suggestions.push('Alternative evacuation routes');
    suggestions.push('Transportation during emergencies');
  } else {
    suggestions.push('Current weather alerts for my area');
    suggestions.push('Emergency kit checklist');
    suggestions.push('How to stay updated during disasters');
  }

  return suggestions.slice(0, 3); // Return max 3 suggestions
}

// Fallback responses for when AI service is unavailable
function generateFallbackResponse(message) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('emergency') || lowerMessage.includes('help')) {
    return `I'm currently experiencing connectivity issues, but here's immediate help:

🚨 EMERGENCY CONTACTS:
• National Emergency: 999
• Fire Service: 9555555
• Police: 100
• Ambulance: 199

If you're in immediate danger:
1. Move to a safe location
2. Call emergency services
3. Follow local authority instructions
4. Stay calm and help others if possible

I'll be back online shortly to provide more detailed assistance.`;
  }

  if (lowerMessage.includes('flood')) {
    return `Flood Safety (Offline Mode):

🌊 IMMEDIATE ACTIONS:
• Move to higher ground immediately
• Avoid walking/driving through flood water
• Turn off electricity if water is near outlets
• Listen to radio for updates

📍 SAFE AREAS:
• Multi-story buildings (2nd floor or higher)
• Schools and community centers on high ground
• Designated flood shelters

⚠️ AVOID:
• Electrical equipment when wet
• Contaminated flood water
• Driving through flooded roads

Contact 999 for emergency rescue services.`;
  }

  if (lowerMessage.includes('cyclone')) {
    return `Cyclone Safety (Offline Mode):

🌪️ IMMEDIATE ACTIONS:
• Go to nearest cyclone shelter
• Secure loose objects outside
• Stock emergency supplies
• Charge all devices

📍 CYCLONE SHELTERS:
• Schools and community centers
• Multi-purpose cyclone shelters
• Concrete buildings away from coast

⚠️ STAY AWAY FROM:
• Coastal areas
• Weak structures
• Open areas during storm

Follow local evacuation orders immediately!`;
  }

  return `I'm currently offline, but here are general disaster safety tips:

🛡️ GENERAL SAFETY:
• Stay informed through radio/TV
• Keep emergency kit ready
• Know your evacuation routes
• Have emergency contacts handy

📞 EMERGENCY NUMBERS:
• National Emergency: 999
• Fire Service: 9555555
• Police: 100

I'll provide more specific guidance once I'm back online. Stay safe!`;
}

// Get disaster risk assessment for location
router.post('/risk-assessment', async (req, res) => {
  try {
    const { location } = req.body;

    if (!location) {
      return res.status(400).json({
        success: false,
        message: 'Location is required'
      });
    }

    // This is a simplified risk assessment
    // In a real implementation, you'd integrate with weather APIs and geological data
    const riskAssessment = {
      flood: 'moderate',
      cyclone: location.latitude < 24 ? 'high' : 'low', // Southern Bangladesh
      earthquake: 'moderate',
      landslide: location.latitude > 24 ? 'moderate' : 'low' // Northern hilly areas
    };

    res.json({
      success: true,
      riskAssessment,
      recommendations: [
        'Keep emergency kit updated',
        'Know your evacuation routes',
        'Stay informed about weather alerts'
      ]
    });

  } catch (error) {
    console.error('Risk Assessment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating risk assessment'
    });
  }
});

// Get evacuation routes
router.post('/evacuation-routes', async (req, res) => {
  try {
    const { location, disasterType } = req.body;

    if (!location) {
      return res.status(400).json({
        success: false,
        message: 'Location is required'
      });
    }

    // This is a simplified route suggestion
    // In a real implementation, you'd integrate with mapping services and real-time traffic data
    const routes = [
      {
        name: 'Primary Route',
        description: 'Main highway to nearest safe zone',
        estimatedTime: '15-30 minutes',
        safetyLevel: 'high'
      },
      {
        name: 'Alternative Route',
        description: 'Secondary road avoiding flood-prone areas',
        estimatedTime: '20-40 minutes',
        safetyLevel: 'moderate'
      }
    ];

    res.json({
      success: true,
      routes,
      nearestShelters: [
        'Community Center - 2.5 km',
        'School Building - 3.1 km',
        'Government Office - 4.2 km'
      ]
    });

  } catch (error) {
    console.error('Evacuation Routes Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating evacuation routes'
    });
  }
});

module.exports = router;
